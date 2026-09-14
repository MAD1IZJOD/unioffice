import type {
  MemberId,
  OrganizationId,
  OrganizationMember,
  UserId,
  WorkspaceId,
  WorkspaceMember,
} from "@unioffice/core";

import {
  LastOwnerError,
  MemberConflictError,
  type MembershipRepository,
} from "./membership-repository.js";

/**
 * Members and grants without a database, enforcing the same constraints the
 * migration does: one row per email and per user in an organization, an
 * invitation claimed at most once, and never zero active owners.
 */
export class InMemoryMembershipRepository implements MembershipRepository {
  readonly members = new Map<MemberId, OrganizationMember>();
  readonly grants: WorkspaceMember[] = [];

  async findMember(organizationId: OrganizationId, memberId: MemberId): Promise<OrganizationMember | null> {
    const member = this.members.get(memberId);
    return member && member.organizationId === organizationId ? structuredClone(member) : null;
  }

  async findMemberByUser(organizationId: OrganizationId, userId: UserId): Promise<OrganizationMember | null> {
    const member = [...this.members.values()].find((entry) =>
      entry.organizationId === organizationId && entry.userId === userId);
    return member ? structuredClone(member) : null;
  }

  async findMembershipsForUser(userId: UserId): Promise<OrganizationMember[]> {
    return [...this.members.values()]
      .filter((entry) => entry.userId === userId)
      .map((entry) => structuredClone(entry));
  }

  async findInvitationsForEmail(email: string): Promise<OrganizationMember[]> {
    const wanted = email.toLowerCase();
    return [...this.members.values()]
      .filter((entry) => entry.email === wanted && entry.status === "invited" && !entry.userId)
      .map((entry) => structuredClone(entry));
  }

  async listMembers(organizationId: OrganizationId): Promise<OrganizationMember[]> {
    return [...this.members.values()]
      .filter((entry) => entry.organizationId === organizationId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => structuredClone(entry));
  }

  async createMember(member: OrganizationMember): Promise<OrganizationMember> {
    const email = member.email.toLowerCase();
    const clash = [...this.members.values()].some((entry) =>
      entry.organizationId === member.organizationId &&
      (entry.email === email || (member.userId !== undefined && entry.userId === member.userId)));

    if (clash) throw new MemberConflictError();
    if (member.status !== "invited" && !member.userId) {
      throw new Error("Failed to add member: only an invitation may have no user");
    }

    const stored = { ...structuredClone(member), email };
    this.members.set(member.id, stored);
    return structuredClone(stored);
  }

  async updateMember(member: OrganizationMember): Promise<OrganizationMember> {
    const current = this.members.get(member.id);

    if (!current || current.organizationId !== member.organizationId) {
      throw new Error("Failed to update member: not found");
    }

    const next: OrganizationMember = { ...current, role: member.role, status: member.status, updatedAt: member.updatedAt };

    if (this.losesLastOwner(current, next)) throw new LastOwnerError();

    this.members.set(member.id, next);
    return structuredClone(next);
  }

  async deleteMember(organizationId: OrganizationId, memberId: MemberId): Promise<void> {
    const current = this.members.get(memberId);
    if (!current || current.organizationId !== organizationId) return;

    if (this.losesLastOwner(current, undefined)) throw new LastOwnerError();

    this.members.delete(memberId);
    this.grants.splice(0, this.grants.length, ...this.grants.filter((grant) => grant.memberId !== memberId));
  }

  async claimInvitation(memberId: MemberId, userId: UserId, now: Date): Promise<OrganizationMember | null> {
    const current = this.members.get(memberId);
    if (!current || current.status !== "invited" || current.userId) return null;

    const taken = [...this.members.values()].some((entry) =>
      entry.organizationId === current.organizationId && entry.userId === userId);
    if (taken) throw new MemberConflictError();

    const claimed: OrganizationMember = { ...current, userId, status: "active", updatedAt: now };
    this.members.set(memberId, claimed);
    return structuredClone(claimed);
  }

  async listWorkspaceGrantsForMember(organizationId: OrganizationId, memberId: MemberId): Promise<WorkspaceMember[]> {
    return this.grants
      .filter((grant) => grant.organizationId === organizationId && grant.memberId === memberId)
      .map((grant) => structuredClone(grant));
  }

  async listWorkspaceGrants(organizationId: OrganizationId): Promise<WorkspaceMember[]> {
    return this.grants
      .filter((grant) => grant.organizationId === organizationId)
      .map((grant) => structuredClone(grant));
  }

  async grantWorkspace(grant: WorkspaceMember): Promise<WorkspaceMember> {
    const index = this.grants.findIndex((entry) =>
      entry.workspaceId === grant.workspaceId && entry.memberId === grant.memberId);

    if (index === -1) {
      this.grants.push(structuredClone(grant));
      return structuredClone(grant);
    }

    const updated = { ...this.grants[index]!, access: grant.access, grantedBy: grant.grantedBy, updatedAt: grant.updatedAt };
    this.grants[index] = updated;
    return structuredClone(updated);
  }

  async revokeWorkspace(organizationId: OrganizationId, workspaceId: WorkspaceId, memberId: MemberId): Promise<void> {
    const kept = this.grants.filter((grant) =>
      !(grant.organizationId === organizationId && grant.workspaceId === workspaceId && grant.memberId === memberId));
    this.grants.splice(0, this.grants.length, ...kept);
  }

  private losesLastOwner(current: OrganizationMember, next: OrganizationMember | undefined): boolean {
    const wasActiveOwner = current.role === "owner" && current.status === "active";
    const staysActiveOwner = next?.role === "owner" && next.status === "active";

    if (!wasActiveOwner || staysActiveOwner) return false;

    return ![...this.members.values()].some((entry) =>
      entry.organizationId === current.organizationId &&
      entry.id !== current.id &&
      entry.role === "owner" &&
      entry.status === "active");
  }
}
