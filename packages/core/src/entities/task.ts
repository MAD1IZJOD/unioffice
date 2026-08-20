export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: string;

  workId: string;

  parentTaskId?: string;

  title: string;

  description: string;

  status: TaskStatus;

  assignedAgentId?: string;

  dependsOn: string[];

  createdAt: Date;

  updatedAt: Date;

  startedAt?: Date;

  completedAt?: Date;

  result?: unknown;

  metadata: Record<string, unknown>;
}