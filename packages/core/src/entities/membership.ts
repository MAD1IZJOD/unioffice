import type {
  MemberId,
  OrganizationId,
  UserId,
  WorkspaceId,
  WorkspaceMemberId,
} from "../types/ids.js";

/**
 * People in an organization.
 *
 * A member is a signed-in person's place in one organization: their role, and
 * whether that place is live. Before they have signed in, an invitation is the
 * same row keyed by email with no user behind it yet.
 *
 * Roles are deliberately few, and each is a superset of the one below it:
 *
 *   owner  - everything, including other owners
 *   admin  - runs the organization; cannot touch owners
 *   member - does the work in the workspaces they can reach
 *   viewer - reads what they can reach; changes nothing
 *
 * What a role may do is decided in one place in the API, never inferred from
 * these shapes.
 */

export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

export const ORGANIZATION_ROLES: readonly OrganizationRole[] = [
  "owner",
  "admin",
  "member",
  "viewer",
];

/**
 * invited   - added by email, not yet signed in
 * active    - signed in and allowed in
 * suspended - kept on record, allowed nothing
 */
export type MemberStatus = "invited" | "active" | "suspended";

export const MEMBER_STATUSES: readonly MemberStatus[] = [
  "invited",
  "active",
  "suspended",
];

export interface OrganizationMember {
  id: MemberId;

  organizationId: OrganizationId;

  /** Absent only while an invitation has not been accepted. */
  userId?: UserId;

  /** Lowercased. What an invitation is matched on when the person signs in. */
  email: string;

  role: OrganizationRole;

  status: MemberStatus;

  invitedBy?: UserId;

  createdAt: Date;

  updatedAt: Date;
}

/**
 * member - may act in the workspace, within what their role allows
 * viewer - may only read in the workspace
 *
 * Owners and admins reach every workspace and hold no grants.
 */
export type WorkspaceAccessLevel = "member" | "viewer";

export const WORKSPACE_ACCESS_LEVELS: readonly WorkspaceAccessLevel[] = [
  "member",
  "viewer",
];

export interface WorkspaceMember {
  id: WorkspaceMemberId;

  organizationId: OrganizationId;

  workspaceId: WorkspaceId;

  memberId: MemberId;

  access: WorkspaceAccessLevel;

  grantedBy?: UserId;

  createdAt: Date;

  updatedAt: Date;
}
