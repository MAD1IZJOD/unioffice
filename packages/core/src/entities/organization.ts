import type { OrganizationId } from "../types/ids.js";

export type OrganizationStatus =
  | "active"
  | "suspended"
  | "archived";

export interface Organization {
  id: OrganizationId;

  name: string;

  slug: string;

  status: OrganizationStatus;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}