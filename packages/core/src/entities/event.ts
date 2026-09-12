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
  | "work.retried"
  | "work.queued"
  | "task.created"
  | "task.ready"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "agent.assigned"
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "agent.created"
  | "agent.updated"
  | "workspace.created"
  | "workspace.updated"
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
  | "tool.failed"
  // Governance. The audit trail is this log rather than a table of its own -
  // a decision about an action belongs beside the action it was about, and a
  // separate store would be a second history to keep in step with this one.
  | "policy.created"
  | "policy.updated"
  | "policy.activated"
  | "policy.paused"
  | "policy.archived"
  | "governance.allowed"
  | "governance.approval_required"
  | "governance.denied";

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
