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
  id: string;

  organizationId: string;

  workId?: string;

  taskId?: string;

  createdByAgentId?: string;

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