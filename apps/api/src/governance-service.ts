import {
  createEntityId,
  type Agent,
  type AgentId,
  type OrganizationId,
  type Policy,
  type PolicyId,
  type PolicyStatus,
  type Task,
  type Work,
} from "@unioffice/core";

import type {
  PolicyRepository,
} from "@unioffice/database";

import {
  DefaultPolicyEngine,
  type GovernanceAction,
  type GovernanceContext,
  type GovernanceDecision,
  type PolicyEngine,
} from "@unioffice/governance";

import type { ToolRegistry } from "@unioffice/tools";

import type { EventRecorder } from "./event-recorder.js";

/**
 * The company's control layer.
 *
 * One question, asked at the two points where the system can actually be
 * stopped: may this step start, and may this tool run. Everything else in the
 * product reads governance; this is the only thing that decides it.
 *
 * Three properties are deliberate:
 *
 * - Deterministic. The engine is pure and no model is consulted. Asking a
 *   language model whether an action is permitted would make the answer
 *   unreproducible, which is disqualifying for something that has to be
 *   defensible after the fact.
 * - Recorded. Every decision that is not a plain uneventful allow is written
 *   to the event log, so the audit trail is a by-product of enforcement
 *   rather than something maintained alongside it and able to disagree.
 * - Additive. Governance narrows what the tool registry and the agent's own
 *   grants already permit. It can never widen them.
 */

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyValidationError";
  }
}

export class PolicyNotFoundError extends Error {
  constructor(id: string) {
    super(`Policy not found: ${id}`);
    this.name = "PolicyNotFoundError";
  }
}

export interface CreatePolicyInput {
  organizationId: OrganizationId;
  name: string;
  description: string;
  subject: Policy["subject"];
  effect: Policy["effect"];
  risk: Policy["risk"];
  status?: PolicyStatus;
  scope?: Partial<Policy["scope"]>;
  approvalPrompt?: string;
  createdBy?: string;
}

export interface UpdatePolicyInput {
  organizationId: OrganizationId;
  policyId: PolicyId;
  name?: string;
  description?: string;
  effect?: Policy["effect"];
  risk?: Policy["risk"];
  status?: PolicyStatus;
  scope?: Partial<Policy["scope"]>;
  /** null clears the prompt; undefined leaves it alone. */
  approvalPrompt?: string | null;
}

/** What the decision was about, for the audit line. */
export interface DecisionSubject {
  organizationId: OrganizationId;
  workId?: Work["id"];
  taskId?: Task["id"];
  agentId?: AgentId;
  /** "Use calculator" or the step's title. Never raw tool input. */
  action: string;
}

export class GovernanceService {
  private readonly engine: PolicyEngine;

  constructor(
    private readonly policyRepository: PolicyRepository,
    private readonly toolRegistry: ToolRegistry,
    private readonly eventRecorder: EventRecorder,
    engine: PolicyEngine = new DefaultPolicyEngine(),
  ) {
    this.engine = engine;
  }

  /* ----------------------------------------------------------------------
     Evaluation. The execution path.
     ---------------------------------------------------------------------- */

  /**
   * Whether a step may be handed to its agent.
   *
   * Called before the step becomes ready, so a denial stops it before any
   * model is invoked and an approval requirement is raised before work is
   * wasted on something a person may refuse.
   */
  async evaluateTask(
    work: Work,
    task: Task,
    agent: Agent | undefined,
  ): Promise<GovernanceDecision> {
    const policies = await this.policyRepository.findEnforced(
      work.organizationId,
    );

    return this.engine.evaluate(
      {
        kind: "task",
        title: task.title,
        requiredTools: requiredToolsOf(task),
      },
      {
        organizationId: work.organizationId,
        agentId: agent?.id,
        agentCapabilities: agent?.capabilities ?? [],
        agentToolIds: agent?.toolIds ?? [],
        workspaceId: work.workspaceId,
        workId: work.id,
        taskId: task.id,
      },
      policies,
    );
  }

  /**
   * Whether one tool call may run.
   *
   * A tool decision is only ever allow or deny at the point of the call - by
   * then the agent is mid-reasoning and there is nothing sensible to suspend.
   * A tool that should need a person is governed at the step instead, which
   * is why require_approval is folded into deny here and says so.
   */
  async evaluateToolCall(input: {
    organizationId: OrganizationId;
    toolId: string;
    agentId?: AgentId;
    agentCapabilities: string[];
    agentToolIds: string[];
    workspaceId?: Work["workspaceId"];
    workId?: Work["id"];
    taskId?: Task["id"];
  }): Promise<GovernanceDecision> {
    const policies = await this.policyRepository.findEnforced(
      input.organizationId,
    );

    const action: GovernanceAction = {
      kind: "tool",
      toolId: input.toolId,
      toolRisk: this.toolRegistry.get(input.toolId)?.risk ?? "low",
    };

    const context: GovernanceContext = {
      organizationId: input.organizationId,
      agentId: input.agentId,
      agentCapabilities: input.agentCapabilities,
      agentToolIds: input.agentToolIds,
      workspaceId: input.workspaceId,
      workId: input.workId,
      taskId: input.taskId,
    };

    return this.engine.evaluate(action, context, policies);
  }

  /**
   * Writes the decision to the event log.
   *
   * A plain allow with no policy behind it is not recorded. Governance runs
   * on every step and every tool call, and writing "nothing applied" each
   * time would bury the decisions that matter under the ones that do not.
   */
  async recordDecision(
    decision: GovernanceDecision,
    subject: DecisionSubject,
  ): Promise<void> {
    if (decision.outcome === "allow" && decision.reasons.length === 0) {
      return;
    }

    const type =
      decision.outcome === "deny"
        ? "governance.denied"
        : decision.outcome === "require_approval"
          ? "governance.approval_required"
          : "governance.allowed";

    await this.eventRecorder.record({
      organizationId: subject.organizationId,
      workId: subject.workId,
      taskId: subject.taskId,
      agentId: subject.agentId,
      type,
      payload: {
        action: subject.action,
        outcome: decision.outcome,
        risk: decision.risk,
        summary: decision.summary,
        policyId: decision.decidingPolicyId,
        policyName: decision.decidingPolicyName,
        // Every policy that matched, so the record explains the decision
        // rather than only naming the winner. Deliberately no tool input:
        // an audit line must never become a place arguments leak.
        reasons: decision.reasons.map((reason) => ({
          policyId: reason.policyId,
          policyName: reason.policyName,
          effect: reason.effect,
          risk: reason.risk,
          explanation: reason.explanation,
        })),
      },
    });
  }

  /* ----------------------------------------------------------------------
     Authoring. The control surface.
     ---------------------------------------------------------------------- */

  async listPolicies(
    organizationId: OrganizationId,
    options: { includeArchived?: boolean } = {},
  ): Promise<Policy[]> {
    return this.policyRepository.findByOrganization(organizationId, {
      includeArchived: options.includeArchived,
    });
  }

  async getPolicy(
    organizationId: OrganizationId,
    policyId: PolicyId,
  ): Promise<Policy> {
    const policy = await this.policyRepository.findById(policyId);

    // A policy belonging to another organization is not found rather than
    // forbidden - the same shape every other scoped read here uses.
    if (!policy || policy.organizationId !== organizationId) {
      throw new PolicyNotFoundError(policyId);
    }

    return policy;
  }

  async createPolicy(input: CreatePolicyInput): Promise<Policy> {
    const name = requiredText(input.name, "name");
    const scope = normalizeScope(input.scope);

    this.validate({
      name,
      subject: input.subject,
      effect: input.effect,
      scope,
    });

    const now = new Date();
    const policy = await this.policyRepository.create({
      id: createEntityId<"PolicyId">() as PolicyId,
      organizationId: input.organizationId,
      name,
      description: input.description?.trim() ?? "",
      subject: input.subject,
      scope,
      effect: input.effect,
      risk: input.risk,
      // New rules start as drafts. A policy that began enforcing the moment
      // it was typed would make the authoring form a live control surface,
      // and a half-finished scope would stop real work.
      status: input.status ?? "draft",
      approvalPrompt: input.approvalPrompt?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      metadata: {},
    });

    await this.eventRecorder.record({
      organizationId: policy.organizationId,
      actorType: "user",
      actorId: input.createdBy,
      type: "policy.created",
      payload: {
        policyId: policy.id,
        name: policy.name,
        subject: policy.subject,
        effect: policy.effect,
        risk: policy.risk,
        status: policy.status,
      },
    });

    return policy;
  }

  async updatePolicy(input: UpdatePolicyInput): Promise<Policy> {
    const current = await this.getPolicy(input.organizationId, input.policyId);

    if (current.status === "archived") {
      throw new PolicyValidationError(
        "An archived policy cannot be changed. Create a new one instead.",
      );
    }

    const name =
      input.name === undefined ? current.name : requiredText(input.name, "name");

    const scope =
      input.scope === undefined
        ? current.scope
        : normalizeScope({ ...current.scope, ...input.scope });

    const effect = input.effect ?? current.effect;

    this.validate({ name, subject: current.subject, effect, scope });

    const status = input.status ?? current.status;

    const updated = await this.policyRepository.update({
      ...current,
      name,
      description:
        input.description === undefined
          ? current.description
          : input.description.trim(),
      effect,
      risk: input.risk ?? current.risk,
      status,
      scope,
      approvalPrompt:
        input.approvalPrompt === undefined
          ? current.approvalPrompt
          : (input.approvalPrompt?.trim() || undefined),
      updatedAt: new Date(),
    });

    // A lifecycle move is the consequential edit - it is the moment a rule
    // starts or stops constraining real execution - so it gets its own line
    // in the trail rather than being folded into a generic update.
    const lifecycle = lifecycleEvent(current.status, updated.status);

    await this.eventRecorder.record({
      organizationId: updated.organizationId,
      actorType: "user",
      type: lifecycle ?? "policy.updated",
      payload: {
        policyId: updated.id,
        name: updated.name,
        effect: updated.effect,
        risk: updated.risk,
        status: updated.status,
        previousStatus: current.status,
      },
    });

    return updated;
  }

  /**
   * Refuses configurations that cannot mean anything.
   *
   * Kept here rather than in the route handler so the same rules apply
   * however a policy is written.
   */
  private validate(policy: {
    name: string;
    subject: Policy["subject"];
    effect: Policy["effect"];
    scope: Policy["scope"];
  }): void {
    if (policy.name.length > 120) {
      throw new PolicyValidationError("name must be 120 characters or fewer.");
    }

    const unknownTools = policy.scope.toolIds.filter(
      (toolId) => !this.toolRegistry.get(toolId),
    );

    if (unknownTools.length > 0) {
      throw new PolicyValidationError(
        `These tools are not registered: ${unknownTools.join(", ")}.`,
      );
    }

    // A tool rule that requires approval cannot be honoured: by the time a
    // tool call happens the agent is mid-reasoning and there is nothing to
    // suspend. Saying so at authoring time is far better than silently
    // treating it as a denial at three in the morning.
    if (policy.subject === "tool" && policy.effect === "require_approval") {
      throw new PolicyValidationError(
        "A tool policy can only allow or deny. To put a person in front of it, write a task policy instead - approval happens before a step starts, not in the middle of one.",
      );
    }
  }
}

function lifecycleEvent(
  from: PolicyStatus,
  to: PolicyStatus,
): "policy.activated" | "policy.paused" | "policy.archived" | undefined {
  if (from === to) return undefined;
  if (to === "active") return "policy.activated";
  if (to === "paused") return "policy.paused";
  if (to === "archived") return "policy.archived";

  return undefined;
}

function normalizeScope(
  scope: Partial<Policy["scope"]> | undefined,
): Policy["scope"] {
  return {
    agentIds: unique(scope?.agentIds),
    toolIds: unique(scope?.toolIds),
    workspaceIds: unique(scope?.workspaceIds),
    capabilities: unique(scope?.capabilities),
  };
}

function unique<T>(values: T[] | undefined): T[] {
  return [...new Set(values ?? [])];
}

function requiredText(value: string | undefined, field: string): string {
  const text = value?.trim();

  if (!text) {
    throw new PolicyValidationError(`${field} is required.`);
  }

  return text;
}

function requiredToolsOf(task: Task): string[] {
  const routing = task.metadata.routing;

  if (typeof routing !== "object" || routing === null) {
    return [];
  }

  const requiredTools = (routing as Record<string, unknown>).requiredTools;

  return Array.isArray(requiredTools)
    ? requiredTools.filter((tool): tool is string => typeof tool === "string")
    : [];
}
