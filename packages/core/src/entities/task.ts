import type {
  AgentId,
  TaskId,
  WorkId,
} from "../types/ids.js";

export type TaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  id: TaskId;

  workId: WorkId;

  parentTaskId?: TaskId;

  title: string;

  description: string;

  status: TaskStatus;

  assignedAgentId?: AgentId;

  dependsOn: TaskId[];

  createdAt: Date;

  updatedAt: Date;

  startedAt?: Date;

  completedAt?: Date;

  result?: unknown;

  metadata: Record<string, unknown>;
}