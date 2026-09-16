import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  WorkspaceAccessLevel,
  WorkspaceId,
} from "@unioffice/core";

import {
  canActIn,
  canAssignRole,
  canDecideApproval,
  canManageMember,
  reachableWorkspaces,
  reaches,
  roleCan,
  type Access,
  type Permission,
} from "./permissions.js";

const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const legal = "10000000-0000-4000-8000-00000000000e" as WorkspaceId;

function access(role: OrganizationRole, grants: Array<[WorkspaceId, WorkspaceAccessLevel]> = []): Access {
  return {
    userId: "u" as UserId,
    email: "person@example.test",
    organizationId: "o" as OrganizationId,
    memberId: "m" as MemberId,
    role,
    workspaces: new Map(grants),
  };
}

test("each role holds exactly the permissions it is meant to", () => {
  const matrix: Record<Permission, OrganizationRole[]> = {
    "organization.read": ["owner", "admin", "member", "viewer"],
    "organization.manage": ["owner"],
    "members.manage": ["owner", "admin"],
    "owners.manage": ["owner"],
    "workspaces.manage": ["owner", "admin"],
    "agents.configure": ["owner", "admin"],
    "policies.manage": ["owner", "admin"],
    "missions.create": ["owner", "admin", "member"],
    "missions.operate": ["owner", "admin", "member"],
    "approvals.decide": ["owner", "admin", "member"],
    "knowledge.propose": ["owner", "admin", "member"],
    "knowledge.curate": ["owner", "admin"],
    "connections.manage": ["owner", "admin"],
  };

  for (const [permission, allowed] of Object.entries(matrix) as Array<[Permission, OrganizationRole[]]>) {
    for (const role of ["owner", "admin", "member", "viewer"] as OrganizationRole[]) {
      assert.equal(roleCan(role, permission), allowed.includes(role), `${role} / ${permission}`);
    }
  }
});

test("a viewer can do nothing that changes anything, anywhere", () => {
  const viewer = access("viewer", [[finance, "member"]]);
  const changes: Permission[] = [
    "organization.manage", "members.manage", "owners.manage", "workspaces.manage", "agents.configure",
    "policies.manage", "missions.create", "missions.operate", "approvals.decide", "knowledge.propose", "knowledge.curate",
    "connections.manage",
  ];

  for (const permission of changes) {
    assert.equal(canActIn(viewer, permission, undefined), false, permission);
    assert.equal(canActIn(viewer, permission, finance), false, `${permission} even with a member grant`);
  }
});

test("owners and admins reach every workspace; members and viewers only company-wide and their grants", () => {
  assert.equal(reaches(access("owner"), legal), true);
  assert.equal(reaches(access("admin"), legal), true);
  assert.equal(reachableWorkspaces(access("admin")), "all");

  const member = access("member", [[finance, "viewer"]]);
  assert.equal(reaches(member, undefined), true, "company-wide resources are reachable");
  assert.equal(reaches(member, null), true);
  assert.equal(reaches(member, finance), true);
  assert.equal(reaches(member, legal), false);
  assert.deepEqual([...(reachableWorkspaces(member) as Set<WorkspaceId>)], [finance]);
});

test("a member acts only where their grant lets them act", () => {
  const member = access("member", [[finance, "member"], [legal, "viewer"]]);

  assert.equal(canActIn(member, "missions.operate", undefined), true, "company-wide work");
  assert.equal(canActIn(member, "missions.operate", finance), true);
  assert.equal(canActIn(member, "missions.operate", legal), false, "a viewer grant is read-only");
  assert.equal(canActIn(member, "missions.operate", "99999999-0000-4000-8000-000000000009" as WorkspaceId), false);
  assert.equal(canActIn(member, "agents.configure", finance), false, "a grant never adds to what the role allows");
});

test("nobody manages anyone at or above their rank except an owner", () => {
  assert.equal(canManageMember("owner", "owner"), true);
  assert.equal(canManageMember("admin", "owner"), false);
  assert.equal(canManageMember("admin", "admin"), false);
  assert.equal(canManageMember("admin", "member"), true);
  assert.equal(canManageMember("admin", "viewer"), true);
  assert.equal(canManageMember("member", "viewer"), false);
  assert.equal(canManageMember("viewer", "viewer"), false);
});

test("nobody grants a role above their own reach", () => {
  assert.equal(canAssignRole("owner", "owner"), true);
  assert.equal(canAssignRole("admin", "owner"), false, "an admin cannot create or transfer ownership");
  assert.equal(canAssignRole("admin", "admin"), false, "an admin cannot mint admins");
  assert.equal(canAssignRole("admin", "member"), true);
  assert.equal(canAssignRole("member", "member"), false);
});

test("a policy-required decision needs an owner or admin; a member decides only the planner's own", () => {
  const member = access("member", [[finance, "member"]]);

  assert.equal(canDecideApproval(member, { workspaceId: finance, governedByPolicy: false }), true);
  assert.equal(canDecideApproval(member, { workspaceId: finance, governedByPolicy: true }), false);
  assert.equal(canDecideApproval(member, { workspaceId: legal, governedByPolicy: false }), false, "not their workspace");
  assert.equal(canDecideApproval(access("admin"), { workspaceId: legal, governedByPolicy: true }), true);
  assert.equal(canDecideApproval(access("viewer"), { workspaceId: undefined, governedByPolicy: false }), false);
});
