import {
  createEntityId,
  ORGANIZATION_ROLES,
  WORKSPACE_ACCESS_LEVELS,
  type MemberId,
  type OrganizationMember,
  type OrganizationRole,
  type Workspace,
  type WorkspaceAccessLevel,
  type WorkspaceId,
  type WorkspaceMember,
  type WorkspaceMemberId,
} from "@unioffice/core";

import type { MembershipRepository } from "@unioffice/database";

import type { EventRecorder } from "../event-recorder.js";

import { AccessError } from "./access-resolver.js";
import { authorize } from "./authorize.js";
import { canAssignRole, canManageMember, type Access } from "./permissions.js";

export class MemberNotFoundError extends Error {
  constructor() {
    super("Member not found.");
    this.name = "MemberNotFoundError";
  }
}

export class MemberValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberValidationError";
  }
}

/** The change is allowed in general but not for this member as they are now. */
export class MemberStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberStateError";
  }
}

export interface MemberView {
  id: MemberId;
  email: string;
  role: OrganizationRole;
  status: OrganizationMember["status"];
  /** Whether this row is the caller. */
  you: boolean;
  joinedAt: string;
  updatedAt: string;
  workspaces: Array<{ workspaceId: WorkspaceId; access: WorkspaceAccessLevel }>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FORBIDDEN = "You do not have permission to do that.";

/**
 * Who belongs to an organization, at what role, and in which workspaces.
 *
 * Every change is checked twice over: the caller's permission, and the
 * relationship between the caller and the member being changed - nobody
 * manages someone at or above their own rank unless they are an owner, and
 * nobody hands out a role above their own reach. The caller's own membership
 * is re-read before each change, so someone demoted or suspended while a
 * request was in flight cannot finish it with the authority they just lost.
 * The database itself refuses to leave an organization without an active
 * owner, whatever order concurrent changes land in.
 */
export class MemberService {
  constructor(
    private readonly members: MembershipRepository,
    private readonly workspaces: { findById(id: WorkspaceId): Promise<Workspace | null> },
    private readonly eventRecorder: Pick<EventRecorder, "record">,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listMembers(access: Access): Promise<MemberView[]> {
    authorize(access, "organization.read");

    const [members, grants] = await Promise.all([
      this.members.listMembers(access.organizationId),
      this.members.listWorkspaceGrants(access.organizationId),
    ]);

    return members.map((member) => view(member, grants, access));
  }

  async invite(access: Access, input: { email: unknown; role: unknown }): Promise<MemberView> {
    const actor = await this.actingAs(access, "members.manage");
    const email = parseEmail(input.email);
    const role = parseRole(input.role);

    if (!canAssignRole(actor.role, role)) throw new AccessError(403, FORBIDDEN);

    const now = this.now();
    const member = await this.members.createMember({
      id: createEntityId<"MemberId">() as MemberId,
      organizationId: access.organizationId,
      email,
      role,
      status: "invited",
      invitedBy: access.userId,
      createdAt: now,
      updatedAt: now,
    });

    await this.audit(access, "member.invited", { memberId: member.id, role });

    return view(member, [], access);
  }

  async changeRole(access: Access, memberId: MemberId, input: { role: unknown }): Promise<MemberView> {
    const actor = await this.actingAs(access, "members.manage");
    const role = parseRole(input.role);
    const target = await this.target(access, memberId);

    if (target.id === actor.id) {
      throw new MemberStateError("You cannot change your own role. Ask another owner.");
    }

    if (!canManageMember(actor.role, target.role) || !canAssignRole(actor.role, role)) {
      throw new AccessError(403, FORBIDDEN);
    }

    if (target.role === role) return this.viewOf(access, target);

    const updated = await this.members.updateMember({ ...target, role, updatedAt: this.now() });
    await this.audit(access, "member.role_changed", { memberId: target.id, role, previousRole: target.role });

    return this.viewOf(access, updated);
  }

  async suspend(access: Access, memberId: MemberId): Promise<MemberView> {
    const target = await this.manageable(access, memberId, "suspend");

    if (target.status === "invited") {
      throw new MemberStateError("An invitation cannot be suspended. Remove it instead.");
    }

    if (target.status === "suspended") return this.viewOf(access, target);

    const updated = await this.members.updateMember({ ...target, status: "suspended", updatedAt: this.now() });
    await this.audit(access, "member.suspended", { memberId: target.id, role: target.role });

    return this.viewOf(access, updated);
  }

  async reactivate(access: Access, memberId: MemberId): Promise<MemberView> {
    const target = await this.manageable(access, memberId, "reactivate");

    if (target.status !== "suspended") return this.viewOf(access, target);

    const updated = await this.members.updateMember({ ...target, status: "active", updatedAt: this.now() });
    await this.audit(access, "member.reactivated", { memberId: target.id, role: target.role });

    return this.viewOf(access, updated);
  }

  async remove(access: Access, memberId: MemberId): Promise<{ removed: MemberId }> {
    const target = await this.manageable(access, memberId, "remove");

    await this.members.deleteMember(access.organizationId, target.id);
    await this.audit(access, "member.removed", { memberId: target.id, role: target.role, status: target.status });

    return { removed: target.id };
  }

  async setWorkspaceAccess(
    access: Access,
    memberId: MemberId,
    input: { workspaceId: unknown; access: unknown },
  ): Promise<MemberView> {
    const actor = await this.actingAs(access, "workspaces.manage");
    const target = await this.target(access, memberId);

    if (target.id !== actor.id && !canManageMember(actor.role, target.role)) {
      throw new AccessError(403, FORBIDDEN);
    }

    const workspaceId = parseWorkspaceId(input.workspaceId);
    const workspace = await this.workspaces.findById(workspaceId);

    // Another organization's workspace is answered exactly like one that
    // does not exist.
    if (!workspace || workspace.organizationId !== access.organizationId) {
      throw new MemberValidationError("That workspace does not exist.");
    }

    const now = this.now();

    if (input.access === null) {
      await this.members.revokeWorkspace(access.organizationId, workspaceId, target.id);
      await this.audit(access, "workspace.access_revoked", { memberId: target.id, workspaceId });
    } else {
      const level = parseAccessLevel(input.access);
      const grant: WorkspaceMember = {
        id: createEntityId<"WorkspaceMemberId">() as WorkspaceMemberId,
        organizationId: access.organizationId,
        workspaceId,
        memberId: target.id,
        access: level,
        grantedBy: access.userId,
        createdAt: now,
        updatedAt: now,
      };

      await this.members.grantWorkspace(grant);
      await this.audit(access, "workspace.access_granted", { memberId: target.id, workspaceId, access: level });
    }

    return this.viewOf(access, target);
  }

  /**
   * The caller as they stand right now. The permission check on the resolved
   * access happens first, so an unauthorized request costs no extra read.
   */
  private async actingAs(access: Access, permission: "members.manage" | "workspaces.manage"): Promise<OrganizationMember> {
    authorize(access, permission);

    const actor = await this.members.findMember(access.organizationId, access.memberId);

    if (!actor || actor.status !== "active" || actor.userId !== access.userId) {
      throw new AccessError(403, FORBIDDEN);
    }

    authorize({ ...access, role: actor.role }, permission);

    return actor;
  }

  private async target(access: Access, memberId: MemberId): Promise<OrganizationMember> {
    const target = await this.members.findMember(access.organizationId, memberId);
    if (!target) throw new MemberNotFoundError();
    return target;
  }

  private async manageable(access: Access, memberId: MemberId, action: string): Promise<OrganizationMember> {
    const actor = await this.actingAs(access, "members.manage");
    const target = await this.target(access, memberId);

    if (target.id === actor.id) {
      throw new MemberStateError(`You cannot ${action} yourself.`);
    }

    if (!canManageMember(actor.role, target.role)) throw new AccessError(403, FORBIDDEN);

    return target;
  }

  private async viewOf(access: Access, member: OrganizationMember): Promise<MemberView> {
    const grants = await this.members.listWorkspaceGrantsForMember(access.organizationId, member.id);
    return view(member, grants, access);
  }

  private async audit(access: Access, type: Parameters<EventRecorder["record"]>[0]["type"], payload: Record<string, unknown>) {
    await this.eventRecorder.record({
      organizationId: access.organizationId,
      type,
      actorType: "user",
      actorId: `user:${access.userId}`,
      payload,
    });
  }
}

function view(member: OrganizationMember, grants: WorkspaceMember[], access: Access): MemberView {
  return {
    id: member.id,
    email: member.email,
    role: member.role,
    status: member.status,
    you: member.id === access.memberId,
    joinedAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
    workspaces: grants
      .filter((grant) => grant.memberId === member.id)
      .map((grant) => ({ workspaceId: grant.workspaceId, access: grant.access })),
  };
}

function parseEmail(value: unknown): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (!EMAIL_PATTERN.test(email) || email.length > 320) {
    throw new MemberValidationError("email must be an email address.");
  }

  return email;
}

function parseRole(value: unknown): OrganizationRole {
  if (typeof value === "string" && (ORGANIZATION_ROLES as readonly string[]).includes(value)) {
    return value as OrganizationRole;
  }

  throw new MemberValidationError(`role must be one of ${ORGANIZATION_ROLES.join(", ")}.`);
}

function parseAccessLevel(value: unknown): WorkspaceAccessLevel {
  if (typeof value === "string" && (WORKSPACE_ACCESS_LEVELS as readonly string[]).includes(value)) {
    return value as WorkspaceAccessLevel;
  }

  throw new MemberValidationError(`access must be one of ${WORKSPACE_ACCESS_LEVELS.join(", ")}, or null to remove it.`);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseWorkspaceId(value: unknown): WorkspaceId {
  if (typeof value === "string" && UUID_PATTERN.test(value)) return value as WorkspaceId;
  throw new MemberValidationError("workspaceId must be a valid identifier.");
}
