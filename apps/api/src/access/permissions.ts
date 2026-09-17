import type {
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

/**
 * Who may do what.
 *
 * Every authorization decision in the API is answered by the functions in this
 * file, from two facts resolved on the server for the signed-in caller: their
 * role in the organization, and which workspaces they were granted. Nothing a
 * request says about itself - an organization id, a workspace id, a role -
 * takes part except as the thing being asked about.
 *
 * Two questions, kept separate on purpose:
 *
 *   can the role do this kind of thing at all?          roleCan()
 *   can this person do it here, in this workspace?      canActIn() / reaches()
 *
 * Agent capabilities, tool grants and governance policies are not permissions
 * of a person and are not decided here. A person with every permission still
 * cannot hand an agent a tool it is not granted, and governance still stops a
 * step whoever started the mission.
 */

export type Permission =
  /** See the organization, its workspaces and its members. */
  | "organization.read"
  /** Change the organization itself. */
  | "organization.manage"
  /** Add, suspend, remove members and change their roles (never owners). */
  | "members.manage"
  /** Make, change or remove owners. */
  | "owners.manage"
  /** Create, rename and archive workspaces; grant workspace access. */
  | "workspaces.manage"
  /** Create and change agents, including which tools they are granted. */
  | "agents.configure"
  /** Author, activate, pause and archive governance policies. */
  | "policies.manage"
  /** Open missions. */
  | "missions.create"
  /** Plan, run, retry, cancel missions and mark them as seen. */
  | "missions.operate"
  /** Approve or reject a step waiting for a person. */
  | "approvals.decide"
  /** Record knowledge as a proposal for review. */
  | "knowledge.propose"
  /** Make knowledge current, edit, archive, merge, replace, settle conflicts. */
  | "knowledge.curate"
  /** Connect and disconnect external systems, and decide what agents may do through them. */
  | "connections.manage"
  /** Write, change, archive and restore the organization's own skills. */
  | "skills.manage";

const EVERYTHING: readonly Permission[] = [
  "organization.read",
  "organization.manage",
  "members.manage",
  "owners.manage",
  "workspaces.manage",
  "agents.configure",
  "policies.manage",
  "missions.create",
  "missions.operate",
  "approvals.decide",
  "knowledge.propose",
  "knowledge.curate",
  "connections.manage",
  "skills.manage",
];

const GRANTS: Record<OrganizationRole, ReadonlySet<Permission>> = {
  owner: new Set(EVERYTHING),
  // Runs the organization. Cannot change the organization's owners or the
  // organization itself, so an admin can never make themselves an owner.
  admin: new Set(EVERYTHING.filter((permission) =>
    permission !== "owners.manage" && permission !== "organization.manage")),
  member: new Set<Permission>([
    "organization.read",
    "missions.create",
    "missions.operate",
    "approvals.decide",
    "knowledge.propose",
  ]),
  viewer: new Set<Permission>(["organization.read"]),
};

export function roleCan(role: OrganizationRole, permission: Permission): boolean {
  return GRANTS[role].has(permission);
}

/**
 * Everything a role may do, for a client deciding which controls to show.
 * Showing is all it decides: every action is checked again on the server.
 */
export function permissionsOf(role: OrganizationRole): Permission[] {
  return EVERYTHING.filter((permission) => GRANTS[role].has(permission));
}

/** The signed-in caller's standing in one organization, resolved on the server. */
export interface Access {
  userId: UserId;
  email: string;
  organizationId: OrganizationId;
  memberId: MemberId;
  role: OrganizationRole;
  /** Workspace grants. Ignored for owners and admins, who reach every workspace. */
  workspaces: ReadonlyMap<WorkspaceId, WorkspaceAccessLevel>;
}

function reachesEverything(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Whether the caller may see things in a workspace. Resources with no
 * workspace are company-wide and reachable by every active member.
 */
export function reaches(access: Access, workspaceId: WorkspaceId | null | undefined): boolean {
  if (!workspaceId) return true;
  if (reachesEverything(access.role)) return true;
  return access.workspaces.has(workspaceId);
}

/**
 * Whether the caller may do something in a workspace: their role must allow
 * it, and where they hold a grant rather than reaching everything, the grant
 * must let them act. A viewer grant never does, and neither does a viewer role
 * with a member grant - the lower of the two always wins.
 */
export function canActIn(
  access: Access,
  permission: Permission,
  workspaceId: WorkspaceId | null | undefined,
): boolean {
  if (!roleCan(access.role, permission)) return false;
  if (!workspaceId || reachesEverything(access.role)) return true;
  return access.workspaces.get(workspaceId) === "member";
}

/** Every workspace the caller reaches, or "all" for owners and admins. */
export function reachableWorkspaces(access: Access): "all" | ReadonlySet<WorkspaceId> {
  return reachesEverything(access.role) ? "all" : new Set(access.workspaces.keys());
}

/**
 * Whether one member may change another's role, status or membership. Nobody
 * manages a member at or above their own rank except an owner, which is what
 * keeps an admin from demoting, suspending or removing an owner - or another
 * admin they could then replace with themselves.
 */
export function canManageMember(actor: OrganizationRole, target: OrganizationRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target === "member" || target === "viewer";
  return false;
}

/** Whether a member may give someone this role. Nobody grants above their own reach. */
export function canAssignRole(actor: OrganizationRole, role: OrganizationRole): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return role === "member" || role === "viewer";
  return false;
}

/**
 * Whether the caller may approve or reject a step.
 *
 * The approval must be in a workspace they can act in. A step that waits
 * because a governance policy requires a person is decided by an owner or an
 * admin; a member may decide only steps the planner itself marked for a
 * person. Governance policies carry no approver list today, so "explicitly
 * permitted by the policy" is never true for a member, and the rule stays
 * deterministic.
 */
export function canDecideApproval(
  access: Access,
  approval: { workspaceId?: WorkspaceId | null; governedByPolicy: boolean },
): boolean {
  if (!canActIn(access, "approvals.decide", approval.workspaceId)) return false;
  if (approval.governedByPolicy && !reachesEverything(access.role)) return false;
  return true;
}
