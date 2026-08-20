export type OrganizationStatus =
  | "active"
  | "suspended"
  | "archived";

export interface Organization {
  id: string;

  name: string;

  slug: string;

  status: OrganizationStatus;

  createdAt: Date;

  updatedAt: Date;

  metadata: Record<string, unknown>;
}