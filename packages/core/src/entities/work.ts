export type WorkStatus =
  | "queued"
  | "planning"
  | "executing"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkPriority =
  | "low"
  | "normal"
  | "high"
  | "critical";

export interface Work {
  id: string;

  organizationId: string;

  workspaceId?: string;

  requesterId: string;

  objective: string;

  status: WorkStatus;

  priority: WorkPriority;

  createdAt: Date;

  updatedAt: Date;

  startedAt?: Date;

  completedAt?: Date;

  metadata: Record<string, unknown>;
}