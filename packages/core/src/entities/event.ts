export type EventType =
  | "work.created"
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
  id: string;

  organizationId: string;

  workId?: string;

  taskId?: string;

  agentId?: string;

  actorType: EventActorType;

  actorId?: string;

  type: EventType;

  timestamp: Date;

  payload: Record<string, unknown>;

  metadata: Record<string, unknown>;
}