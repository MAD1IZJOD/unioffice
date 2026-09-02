import type {
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

  dependsOn: TaskId[];

  metadata: Record<string, unknown>;
}

export interface WorkPlan {
  workId: WorkId;

  tasks: PlannedTask[];

  metadata: Record<string, unknown>;
}

export interface Planner {
  plan(
    context: PlanningContext,
  ): Promise<WorkPlan>;
}
