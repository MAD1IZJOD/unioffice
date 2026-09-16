import { accessFrom, type AccessValue } from "../lib/access";
import type { Me, OrganizationRole, Permission } from "../lib/api";

import { TEST_ORGANIZATION_ID } from "./setup";

/** What each role may do, as the API reports it in /me. */
const PERMISSIONS: Record<OrganizationRole, Permission[]> = {
  owner: [
    "organization.read", "organization.manage", "members.manage", "owners.manage", "workspaces.manage",
    "agents.configure", "policies.manage", "missions.create", "missions.operate", "approvals.decide",
    "knowledge.propose", "knowledge.curate", "connections.manage",
  ],
  admin: [
    "organization.read", "members.manage", "workspaces.manage", "agents.configure", "policies.manage",
    "missions.create", "missions.operate", "approvals.decide", "knowledge.propose", "knowledge.curate",
    "connections.manage",
  ],
  member: ["organization.read", "missions.create", "missions.operate", "approvals.decide", "knowledge.propose"],
  viewer: ["organization.read"],
};

/** A signed-in person with this role, for rendering a page as they would see it. */
export function signedInAs(
  role: OrganizationRole,
  workspaces: Array<{ workspaceId: string; access: "member" | "viewer" }> = [],
): AccessValue {
  const me: Me = {
    user: { id: "user-me", email: "me@example.test" },
    standing: "active",
    organization: { id: TEST_ORGANIZATION_ID, memberId: "member-me", role, permissions: PERMISSIONS[role], workspaces },
    memberships: [{ organizationId: TEST_ORGANIZATION_ID, role, status: "active" }],
  };

  return accessFrom(me);
}
