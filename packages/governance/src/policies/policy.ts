import type {
  AgentId,
  MissionStarter,
  OrganizationId,
  Policy,
  PolicyEffect,
  PolicyId,
  PolicySubject,
  RiskLevel,
  TaskId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

/**
 * What governance is being asked about.
 *
 * Two kinds only, because there are two places the system can actually be
 * stopped: before a step is handed to an agent, and before a tool runs. A
 * question governance cannot be asked at an enforcement point is a question
 * it should not pretend to answer.
 */
export type GovernanceAction =
  | {
      kind: "tool";
      /** The tool the agent is trying to call. */
      toolId: string;
      /** The tool's own baseline risk, from the registry. */
      toolRisk?: RiskLevel;
      /** Whether the registry says this tool writes outside the company. */
      writesExternally?: boolean;
    }
  | {
      kind: "task";
      title: string;
      /** Tools the plan says this step needs, if any. */
      requiredTools: string[];
      /** Those of them the registry says write outside the company. */
      externalWrites?: string[];
    }
  | {
      /** An agent is about to be handed a piece of company knowledge. */
      kind: "knowledge_recall";
      knowledgeType: string;
      title: string;
    }
  | {
      /** Extraction has proposed knowledge and it is about to be recorded. */
      kind: "knowledge_capture";
      knowledgeType: string;
      title: string;
    };

/** Everything a decision is allowed to depend on. */
export interface GovernanceContext {
  organizationId: OrganizationId;

  agentId?: AgentId;

  /** Capabilities the agent actually holds, for capability-scoped policies. */
  agentCapabilities: string[];

  /** Tool grants the agent actually holds. The registry stays authoritative. */
  agentToolIds: string[];

  workspaceId?: WorkspaceId;

  workId?: WorkId;

  taskId?: TaskId;

  /**
   * Who started the mission, read from the mission row. Absent is a person:
   * only a schedule marks the missions it starts.
   */
  startedBy?: MissionStarter;
}

/** One policy's contribution to a decision, in the words a person can read. */
export interface GovernanceReason {
  policyId?: PolicyId;
  policyName: string;
  effect: PolicyEffect;
  risk: RiskLevel;
  /** Why this policy matched, stated concretely. */
  explanation: string;
}

export type GovernanceOutcome =
  | "allow"
  | "require_approval"
  | "deny";

export interface GovernanceDecision {
  outcome: GovernanceOutcome;

  risk: RiskLevel;

  /** Every policy that matched, strongest first. Often empty. */
  reasons: GovernanceReason[];

  /** The policy that actually decided the outcome, when one did. */
  decidingPolicyId?: PolicyId;
  decidingPolicyName?: string;

  /** One sentence a person can act on. Never a stack trace or a rule id. */
  summary: string;

  /** Shown on the approval request when the outcome requires one. */
  approvalPrompt?: string;
}

export interface PolicyEngine {
  /**
   * Deterministic. The same policies and the same context always produce the
   * same decision - no model is consulted, and nothing here reads a clock or
   * a random source. Governance is a security boundary, and a boundary that
   * can answer differently twice is not one.
   */
  evaluate(
    action: GovernanceAction,
    context: GovernanceContext,
    policies: Policy[],
  ): GovernanceDecision;
}

/** Whether a policy's subject covers the action being evaluated. */
export function subjectMatches(
  subject: PolicySubject,
  action: GovernanceAction,
): boolean {
  return subject === action.kind;
}
