import type {
  AgentType,
  AgentId,
  TaskId,
  WorkId,
} from "@unioffice/core";

export interface PlanningContext {
  workId: WorkId;

  objective: string;

  availableAgentIds: AgentId[];

  context: Record<string, unknown>;
}

export interface PlannedTask {
  id: TaskId;

  ref: string;

  title: string;

  description: string;

  assignedAgentId?: AgentId;

  requiredCapabilities?: string[];

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
