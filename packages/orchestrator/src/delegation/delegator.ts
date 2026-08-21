import type {
  AgentId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type {
  PlannedTask,
} from "../planner/planner.js";

export interface DelegationContext {
  workId: WorkId;

  availableAgentIds: AgentId[];

  task: PlannedTask;

  context: Record<string, unknown>;
}

export interface DelegatedTask {
  taskId: TaskId;

  agentId: AgentId;

  metadata: Record<string, unknown>;
}

export interface Delegator {
  delegate(
    context: DelegationContext,
  ): Promise<DelegatedTask>;
}