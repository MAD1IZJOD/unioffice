import type {
  TaskId,
  WorkId,
  WorkflowId,
} from "@unioffice/core";

export type WorkflowNodeType =
  | "task"
  | "approval"
  | "condition";

export interface WorkflowDefinition {
  id: WorkflowId;

  workId: WorkId;

  name: string;

  description?: string;

  nodes: WorkflowNode[];

  metadata: Record<string, unknown>;
}

export interface WorkflowNode {
  id: string;

  type: WorkflowNodeType;

  name: string;

  taskId?: TaskId;

  dependsOn: string[];

  metadata: Record<string, unknown>;
}