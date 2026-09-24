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
  // A step that changed after it was approved. The decision that was given
  // no longer covers what would happen, so it is put back to a person.
  | "approval.superseded"
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
  | "governance.denied"
  // Company knowledge. Recorded here for the same reason governance is: what
  // the company learned, and what it handed an agent, belong beside the work
  // that produced or used it.
  | "knowledge.created"
  | "knowledge.updated"
  | "knowledge.approved"
  | "knowledge.archived"
  | "knowledge.restored"
  | "knowledge.recalled"
  | "knowledge.extraction_rejected"
  | "knowledge.conflict_detected"
  | "knowledge.conflict_resolved"
  | "knowledge.merged"
  | "knowledge.superseded"
  // A person said they have seen a stopped or stalled mission, so it stops
  // asking for attention until something about it changes.
  | "work.acknowledged"
  // Continuous missions. The instruction's own lifecycle; each run's story is
  // told by its mission's events, like any other mission's.
  | "continuous_mission.created"
  | "continuous_mission.paused"
  | "continuous_mission.resumed"
  | "continuous_mission.cancelled"
  | "continuous_mission.run_started"
  | "continuous_mission.run_skipped"
  // Membership. Who was let in, at what role, and by whom - kept beside the
  // work those people went on to do rather than in a log of its own.
  | "member.invited"
  | "member.added"
  | "member.role_changed"
  | "member.suspended"
  | "member.reactivated"
  | "member.removed"
  | "workspace.access_granted"
  | "workspace.access_revoked"
  // External systems. The lifecycle of a connection, and what agents did
  // through one. Payloads name the provider, the connection and the resource
  // touched - never a token, and never the content that was read.
  | "connection.connected"
  | "connection.updated"
  | "connection.needs_attention"
  | "connection.disconnected"
  | "external.read"
  | "external.write"
  // Skills. What the workforce knows how to do, and who changed it.
  | "skill.created"
  | "skill.updated"
  | "skill.archived"
  | "skill.restored";

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
