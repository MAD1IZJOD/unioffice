import type {
  OrganizationId,
  OrganizationMember,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import {
  MemberConflictError,
  type MembershipRepository,
} from "@unioffice/database";

import type { Identity } from "./authenticator.js";
import type { Access } from "./permissions.js";

/**
 * A caller who cannot act in the organization they asked for. 404 when they are
 * not a member, so another company's id reads the same as a made-up one; 403
 * when they are a member whose access is suspended.
 */
export class AccessError extends Error {
  constructor(readonly statusCode: 401 | 403 | 404, message: string) {
    super(message);
    this.name = "AccessError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns a verified identity into what it may do in one organization.
 *
 * Read fresh on every request, deliberately. A role change, a suspension or a
 * removed workspace grant takes effect on the very next request, including one
 * already in the air, rather than whenever a cache happens to expire.
 */
export class AccessResolver {
  constructor(
    private readonly members: MembershipRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(identity: Identity, requestedOrganizationId?: string): Promise<Access> {
    const member = await this.membershipFor(identity, requestedOrganizationId);

    if (!member) throw new AccessError(404, "Organization not found.");
    if (member.status === "suspended") {
      throw new AccessError(403, "Your access to this organization is suspended.");
    }
    if (member.status !== "active") throw new AccessError(404, "Organization not found.");

    const grants = await this.members.listWorkspaceGrantsForMember(member.organizationId, member.id);

    return {
      userId: identity.userId,
      email: identity.email,
      organizationId: member.organizationId,
      memberId: member.id,
      role: member.role,
      workspaces: new Map<WorkspaceId, WorkspaceAccessLevel>(
        grants.map((grant) => [grant.workspaceId, grant.access]),
      ),
    };
  }

  /** Every organization this person can open, after picking up any invitations waiting for them. */
  async organizationsFor(identity: Identity): Promise<OrganizationMember[]> {
    await this.claimInvitations(identity);
    return (await this.members.findMembershipsForUser(identity.userId))
      .filter((member) => member.status !== "invited");
  }

  private async membershipFor(identity: Identity, requested?: string): Promise<OrganizationMember | null> {
    if (requested !== undefined) {
      if (!UUID_PATTERN.test(requested)) return null;

      const organizationId = requested as OrganizationId;
      const existing = await this.members.findMemberByUser(organizationId, identity.userId);
      if (existing) return existing;

      // Not a member yet: an invitation to this address may be waiting.
      await this.claimInvitations(identity);
      return this.members.findMemberByUser(organizationId, identity.userId);
    }

    // No organization named: the oldest one they are active in.
    const memberships = await this.organizationsFor(identity);
    return memberships.find((member) => member.status === "active") ??
      memberships[0] ??
      null;
  }

  private async claimInvitations(identity: Identity): Promise<void> {
    // An unconfirmed address proves nothing about who owns it, so it cannot
    // pick up an invitation sent there.
    if (!identity.emailConfirmed) return;

    const invitations = await this.members.findInvitationsForEmail(identity.email);

    for (const invitation of invitations) {
      try {
        await this.members.claimInvitation(invitation.id, identity.userId, this.now());
      } catch (error) {
        // Already a member there under another address: the existing
        // membership stands and the stray invitation is left alone.
        if (!(error instanceof MemberConflictError)) throw error;
      }
    }
  }
}
