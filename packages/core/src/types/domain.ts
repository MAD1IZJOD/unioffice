export type Priority =
  | "low"
  | "normal"
  | "high"
  | "critical";

export type ExecutionStatus =
  | "pending"
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type Capability =
  | "research"
  | "analysis"
  | "writing"
  | "coding"
  | "data_processing"
  | "communication"
  | "planning"
  | "decision_support"
  | "tool_use";

export type Permission =
  | "read"
  | "write"
  | "execute"
  | "approve"
  | "communicate"
  | "manage";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired";