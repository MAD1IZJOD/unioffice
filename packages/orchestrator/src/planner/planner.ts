import type {
  AgentType,
  AgentId,
  TaskId,
  WorkId,
} from "@unioffice/core";

export interface PlanningToolDescriptor {
  id: string;

  name: string;

  description: string;
}

export interface PlanningContext {
  workId: WorkId;

  objective: string;

  availableAgentIds: AgentId[];

  /** Tools that exist in the system, so the planner can request one by id. */
  availableTools?: PlanningToolDescriptor[];

  /**
   * The union of capabilities actually held by the available agents. A
   * capability the planner invents that no agent has is unsatisfiable by
   * construction, so the planner is constrained to this vocabulary rather
   * than free-texting a plausible-sounding one.
   */
  availableCapabilities?: string[];

  context: Record<string, unknown>;
}

export interface PlannedTask {
  id: TaskId;

  ref: string;

  title: string;

  description: string;

  assignedAgentId?: AgentId;

  requiredCapabilities?: string[];

  /** Tool ids the executing agent must be authorized for. */
  requiredTools?: string[];

  suggestedAgentType?: AgentType;

  requiresApproval?: boolean;

  approvalReason?: string;

  dependsOn: TaskId[];

  metadata: Record<string, unknown>;
}

export interface WorkPlan {
  workId: WorkId;

  objective: string;

  tasks: PlannedTask[];

  metadata: Record<string, unknown>;
}

export interface Planner {
  plan(
    context: PlanningContext,
  ): Promise<WorkPlan>;
}
