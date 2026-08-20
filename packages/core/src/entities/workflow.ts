import type {
  OrganizationId,
  TaskId,
  WorkId,
  WorkflowId,
} from "../types/ids.js";

export type WorkflowStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowNodeType =
  | "task"
  | "approval"
  | "condition";

export interface WorkflowNode {
  id: string;

  type: WorkflowNodeType;

  name: string;

  taskId?: TaskId;

  dependsOn: string[];

  metadata: Record<string, unknown>;
}

export interface Workflow {
  id: WorkflowId;

  organizationId: OrganizationId;

  workId: WorkId;

  name: string;

  description?: string;

  status: WorkflowStatus;

  nodes: WorkflowNode[];

  createdAt: Date;

  updatedAt: Date;

  startedAt?: Date;

  completedAt?: Date;

  metadata: Record<string, unknown>;
}