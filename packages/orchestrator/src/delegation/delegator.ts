import type {
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type {
  PlannedTask,
} from "../planner/planner.js";

export interface DelegationContext {
  workId: WorkId;

  task: PlannedTask;

  availableAgentIds: AgentId[];

  organizationId: OrganizationId;

  workspaceId?: WorkspaceId;

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