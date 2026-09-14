import type {
  MemberId,
  OrganizationId,
  OrganizationMember,
  UserId,
  WorkspaceId,
  WorkspaceMember,
} from "@unioffice/core";

/**
 * Organization members and workspace grants.
 *
 * Every lookup that names an organization stays inside it: a member id from
 * another organization reads as absent, never as a row. Callers resolve who
 * the signed-in person is from their user id; nothing here trusts an id a
 * request supplied without that scope.
 */

/** Raised when removing, demoting or suspending would leave no active owner. */
export class LastOwnerError extends Error {
  constructor() {
    super("An organization must keep at least one active owner.");
    this.name = "LastOwnerError";
  }
}

/** Raised when a person is already a member of the organization. */
export class MemberConflictError extends Error {
  constructor(message = "This person is already a member of the organization.") {
    super(message);
    this.name = "MemberConflictError";
  }
}

export interface MembershipRepository {
  findMember(organizationId: OrganizationId, memberId: MemberId): Promise<OrganizationMember | null>;

  findMemberByUser(organizationId: OrganizationId, userId: UserId): Promise<OrganizationMember | null>;

  /** Every organization the user belongs to, whatever the status. */
  findMembershipsForUser(userId: UserId): Promise<OrganizationMember[]>;

  /** Invitations waiting for someone with this email to sign in. */
  findInvitationsForEmail(email: string): Promise<OrganizationMember[]>;

  listMembers(organizationId: OrganizationId): Promise<OrganizationMember[]>;

  /** Throws MemberConflictError when the email or user is already a member. */
  createMember(member: OrganizationMember): Promise<OrganizationMember>;

  /**
   * Writes role and status. Throws LastOwnerError when the change would leave
   * the organization without an active owner.
   */
  updateMember(member: OrganizationMember): Promise<OrganizationMember>;

  /** Throws LastOwnerError when removing the last active owner. */
  deleteMember(organizationId: OrganizationId, memberId: MemberId): Promise<void>;

  /**
   * Attaches a signed-in user to their invitation, only while it is still an
   * unclaimed invitation. Null when it was already claimed or withdrawn.
   */
  claimInvitation(memberId: MemberId, userId: UserId, now: Date): Promise<OrganizationMember | null>;

  listWorkspaceGrantsForMember(organizationId: OrganizationId, memberId: MemberId): Promise<WorkspaceMember[]>;

  listWorkspaceGrants(organizationId: OrganizationId): Promise<WorkspaceMember[]>;

  /** Grants or changes one member's access to one workspace. */
  grantWorkspace(grant: WorkspaceMember): Promise<WorkspaceMember>;

  revokeWorkspace(organizationId: OrganizationId, workspaceId: WorkspaceId, memberId: MemberId): Promise<void>;
}
