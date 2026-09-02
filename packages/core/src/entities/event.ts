import type {
  AgentId,
  EventId,
  OrganizationId,
  TaskId,
  WorkId,
} from "../types/ids.js";

export type EventType =
  | "work.created"
  | "work.planning_started"
  | "work.planning_completed"
  | "work.started"
  | "work.completed"
  | "work.failed"
  | "work.cancelled"
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "agent.assigned"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "workflow.started"
  | "workflow.completed"
  | "workflow.failed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "artifact.created"
  | "artifact.updated"
  | "tool.called"
  | "tool.completed"
  | "tool.failed";

export type EventActorType =
  | "user"
  | "agent"
  | "system";

export interface Event {
  id: EventId;

  organizationId: OrganizationId;

  workId?: WorkId;

  taskId?: TaskId;

  agentId?: AgentId;

  actorType: EventActorType;

  actorId?: string;

  type: EventType;

  timestamp: Date;

  payload: Record<string, unknown>;

  metadata: Record<string, unknown>;
}
