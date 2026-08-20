import type {
  OrganizationId,
  WorkspaceId,
} from "../types/ids.js";

export type WorkspaceStatus =
  | "active"
  | "archived";

export interface Workspace {
  id: WorkspaceId;

  organizationId: OrganizationId;

  name: string;

  slug: string;

  description?: string;

  status: WorkspaceStatus;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}