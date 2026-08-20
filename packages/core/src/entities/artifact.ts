import type {
  AgentId,
  ArtifactId,
  OrganizationId,
  TaskId,
  WorkId,
} from "../types/ids.js";

export type ArtifactType =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "code"
  | "dataset"
  | "image"
  | "analysis"
  | "structured_data"
  | "other";

export interface Artifact {
  id: ArtifactId;

  organizationId: OrganizationId;

  workId?: WorkId;

  taskId?: TaskId;

  createdByAgentId?: AgentId;

  name: string;

  type: ArtifactType;

  description?: string;

  uri?: string;

  mimeType?: string;

  version: number;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}