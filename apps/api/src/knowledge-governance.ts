import type {
  Agent,
  Memory,
  MemoryType,
  OrganizationId,
  Policy,
  RiskLevel,
  TaskId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import { highestRisk } from "@unioffice/core";

import type { PolicyRepository } from "@unioffice/database";

import {
  DefaultPolicyEngine,
  type GovernanceContext,
  type GovernanceDecision,
  type PolicyEngine,
} from "@unioffice/governance";

import type { GovernanceService } from "./governance-service.js";

/**
 * Governance, applied to company knowledge.
 *
 * Knowledge is a route by which information reaches an agent and by which an
 * agent's output becomes something the company relies on. Either route left
 * ungoverned would be a way around the rules, so both go through the same
 * engine, the same policies and the same audit trail as tools and steps. There
 * is no second permission system here - only the two questions knowledge adds.
 */

export interface KnowledgeActor {
  organizationId: OrganizationId;
  agent?: Agent;
  workspaceId?: WorkspaceId;
  workId?: WorkId;
  taskId?: TaskId;
}

export interface WithheldKnowledge {
  memory: Memory;
  decision: GovernanceDecision;
}

export type CaptureOutcome =
  | { status: "active"; decision: GovernanceDecision; reason: string }
  | { status: "proposed"; decision: GovernanceDecision; reason: string }
  | { status: "discarded"; decision: GovernanceDecision; reason: string };

/**
 * Kinds of knowledge that only a person can make active, whatever a policy
 * says. A rule the company operates by, or a preference someone holds, is
 * never promoted to truth because an extraction step inferred it.
 */
const HUMAN_ONLY_TYPES: readonly MemoryType[] = ["policy", "preference"];

export class KnowledgeGovernance {
  private readonly engine: PolicyEngine;

  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly governanceService: GovernanceService,
    engine: PolicyEngine = new DefaultPolicyEngine(),
  ) {
    this.engine = engine;
  }

  /**
   * Which of these items the actor may be handed.
   *
   * Every item is evaluated; the policies are read once. When anything is
   * withheld, one decision is written to the audit trail for the whole recall
   * rather than one per item - a recall can touch a dozen entries, and a trail
   * that floods is a trail nobody reads.
   */
  async filterRecall(
    actor: KnowledgeActor,
    items: Memory[],
  ): Promise<{ allowed: Memory[]; withheld: WithheldKnowledge[] }> {
    if (items.length === 0) {
      return { allowed: [], withheld: [] };
    }

    const policies = await this.knowledgePolicies(actor.organizationId);
    const context = this.contextFor(actor);
    const allowed: Memory[] = [];
    const withheld: WithheldKnowledge[] = [];

    for (const memory of items) {
      // A row from another organization never reaches evaluation. Retrieval
      // already scopes by organization; this is the second line, not the first.
      if (memory.organizationId !== actor.organizationId) {
        continue;
      }

      const decision = this.engine.evaluate(
        { kind: "knowledge_recall", knowledgeType: memory.type, title: memory.title },
        context,
        policies,
      );

      if (decision.outcome === "allow") {
        allowed.push(memory);
      } else {
        withheld.push({ memory, decision });
      }
    }

    if (withheld.length > 0) {
      await this.governanceService.recordDecision(aggregate(withheld), {
        organizationId: actor.organizationId,
        workId: actor.workId,
        taskId: actor.taskId,
        agentId: actor.agent?.id,
        action: "Recall company knowledge",
      });
    }

    return { allowed, withheld };
  }

  /**
   * What happens to one piece of knowledge extraction proposed.
   *
   * With no policy written, extracted knowledge is recorded as a proposal: AI
   * can suggest knowledge, but a person decides it is true. A company that
   * trusts extraction for some kinds of knowledge can say so with an allow
   * policy; one that wants none of it can deny.
   */
  async decideCapture(
    actor: KnowledgeActor,
    candidate: { type: MemoryType; title: string },
  ): Promise<CaptureOutcome> {
    const policies = await this.knowledgePolicies(actor.organizationId);

    const decision = this.engine.evaluate(
      { kind: "knowledge_capture", knowledgeType: candidate.type, title: candidate.title },
      this.contextFor(actor),
      policies,
    );

    if (decision.reasons.length > 0) {
      await this.governanceService.recordDecision(decision, {
        organizationId: actor.organizationId,
        workId: actor.workId,
        taskId: actor.taskId,
        agentId: actor.agent?.id,
        action: `Record ${candidate.type} knowledge`,
      });
    }

    if (decision.outcome === "deny") {
      return { status: "discarded", decision, reason: decision.summary };
    }

    if (decision.outcome === "require_approval") {
      return { status: "proposed", decision, reason: decision.summary };
    }

    if (decision.reasons.length === 0) {
      return {
        status: "proposed",
        decision,
        reason: "Extracted knowledge is recorded as a proposal until a person reviews it.",
      };
    }

    if (HUMAN_ONLY_TYPES.includes(candidate.type)) {
      return {
        status: "proposed",
        decision,
        reason: `A ${candidate.type} is only made active by a person, whatever a policy allows.`,
      };
    }

    return { status: "active", decision, reason: decision.summary };
  }

  private async knowledgePolicies(organizationId: OrganizationId): Promise<Policy[]> {
    const enforced = await this.policyRepository.findEnforced(organizationId);

    return enforced.filter(
      (policy) =>
        policy.subject === "knowledge_recall" || policy.subject === "knowledge_capture",
    );
  }

  private contextFor(actor: KnowledgeActor): GovernanceContext {
    return {
      organizationId: actor.organizationId,
      agentId: actor.agent?.id,
      agentCapabilities: actor.agent?.capabilities ?? [],
      agentToolIds: actor.agent?.toolIds ?? [],
      workspaceId: actor.workspaceId,
      workId: actor.workId,
      taskId: actor.taskId,
    };
  }
}

function aggregate(withheld: WithheldKnowledge[]): GovernanceDecision {
  const reasons = new Map<string, GovernanceDecision["reasons"][number]>();
  let risk: RiskLevel = "low";

  for (const { decision } of withheld) {
    risk = highestRisk(risk, decision.risk);

    for (const reason of decision.reasons) {
      reasons.set(reason.policyId ?? reason.policyName, reason);
    }
  }

  const first = withheld[0]!.decision;
  const count = withheld.length;

  return {
    outcome: "deny",
    risk,
    reasons: [...reasons.values()],
    decidingPolicyId: first.decidingPolicyId,
    decidingPolicyName: first.decidingPolicyName,
    summary: `${count} knowledge ${count === 1 ? "entry was" : "entries were"} withheld from this step by ${first.decidingPolicyName ?? "policy"}.`,
  };
}
