import type {
  OrganizationId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

/**
 * Workspaces have existed in the schema and in the domain model since the
 * first migration - agents and work both carry a workspace id, and both the
 * planner and the delegator already treat it as a hard routing boundary.
 * Nothing could read or write one, so every organization had exactly zero.
 *
 * Every lookup here is organization-scoped on purpose. A workspace is only
 * ever meaningful inside its organization, and a repository that can return
 * one without being told which organization asked is a repository that makes
 * authorization harder to add later.
 */
export interface WorkspaceRepository {
  create(workspace: Workspace): Promise<Workspace>;

  findById(id: WorkspaceId): Promise<Workspace | null>;

  findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Workspace[]>;

  /** Used to keep (organization, slug) unique before insert. */
  findBySlug(
    organizationId: OrganizationId,
    slug: string,
  ): Promise<Workspace | null>;

  update(workspace: Workspace): Promise<Workspace>;

  delete(id: WorkspaceId): Promise<void>;
}
