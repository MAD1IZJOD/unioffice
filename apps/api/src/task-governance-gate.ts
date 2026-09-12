import type {
  RiskLevel,
  Task,
  Work,
} from "@unioffice/core";

import type { AgentRepository } from "@unioffice/database";

import type { GovernanceService } from "./governance-service.js";

/**
 * What governance decided about a step.
 *
 * Deliberately a small, own-shaped result rather than the engine's decision
 * object: the executor only needs to know what to do next and what to tell a
 * person, and handing it the full reasoning would invite it to start making
 * decisions of its own from the parts.
 */
export interface TaskGovernanceOutcome {
  outcome: "allow" | "require_approval" | "deny";
  risk: RiskLevel;
  /** One sentence, already written for a person. */
  summary: string;
  policyId?: string;
  policyName?: string;
  /** Shown on the approval request when one is raised. */
  approvalPrompt?: string;
}

/**
 * The seam the executor depends on.
 *
 * An interface rather than the service itself, so the execution path can be
 * tested against a governance decision without a database behind it - and so
 * the executor cannot reach past this into policy authoring.
 */
export interface TaskGovernanceGate {
  evaluate(work: Work, task: Task): Promise<TaskGovernanceOutcome>;
}

/**
 * Governance for a step, backed by the real policy store.
 *
 * Runs once per task as it becomes eligible, not once per tool call, so the
 * agent lookup it needs for capability-scoped rules is paid once rather than
 * inside the model loop.
 */
export class PolicyTaskGovernanceGate implements TaskGovernanceGate {
  constructor(
    private readonly governance: GovernanceService,
    private readonly agentRepository: AgentRepository,
  ) {}

  async evaluate(work: Work, task: Task): Promise<TaskGovernanceOutcome> {
    const agent = task.assignedAgentId
      ? ((await this.agentRepository.findById(task.assignedAgentId)) ?? undefined)
      : undefined;

    const decision = await this.governance.evaluateTask(work, task, agent);

    await this.governance.recordDecision(decision, {
      organizationId: work.organizationId,
      workId: work.id,
      taskId: task.id,
      agentId: task.assignedAgentId,
      action: task.title,
    });

    return {
      outcome: decision.outcome,
      risk: decision.risk,
      summary: decision.summary,
      policyId: decision.decidingPolicyId,
      policyName: decision.decidingPolicyName,
      approvalPrompt: decision.approvalPrompt,
    };
  }
}
