import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemberId,
  OrganizationId,
  OrganizationMember,
  UserId,
  WorkspaceId,
  WorkspaceMemberId,
} from "@unioffice/core";

import { InMemoryMembershipRepository } from "./in-memory-membership-repository.js";
import { LastOwnerError, MemberConflictError } from "./membership-repository.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date("2026-09-14T12:00:00.000Z");

let counter = 0;

function member(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}` as MemberId,
    organizationId: orgA,
    userId: `11111111-0000-4000-8000-${String(counter).padStart(12, "0")}` as UserId,
    email: `person${counter}@example.test`,
    role: "member",
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a member is found only inside their own organization", async () => {
  const members = new InMemoryMembershipRepository();
  const alice = await members.createMember(member({ email: "Alice@Example.test" }));

  assert.equal(alice.email, "alice@example.test", "emails are stored lowercased");
  assert.ok(await members.findMember(orgA, alice.id));
  assert.equal(await members.findMember(orgB, alice.id), null);
  assert.equal(await members.findMemberByUser(orgB, alice.userId!), null);
});

test("the same person cannot be added to an organization twice, by email or by user", async () => {
  const members = new InMemoryMembershipRepository();
  const alice = await members.createMember(member({ email: "alice@example.test" }));

  await assert.rejects(members.createMember(member({ email: "ALICE@example.test" })), MemberConflictError);
  await assert.rejects(members.createMember(member({ userId: alice.userId })), MemberConflictError);

  // Another organization is a different membership.
  await members.createMember(member({ organizationId: orgB, email: "alice@example.test", userId: alice.userId }));
  assert.equal((await members.findMembershipsForUser(alice.userId!)).length, 2);
});

test("an organization can never lose its last active owner", async () => {
  const members = new InMemoryMembershipRepository();
  const owner = await members.createMember(member({ role: "owner" }));

  await assert.rejects(members.updateMember({ ...owner, role: "admin" }), LastOwnerError);
  await assert.rejects(members.updateMember({ ...owner, status: "suspended" }), LastOwnerError);
  await assert.rejects(members.deleteMember(orgA, owner.id), LastOwnerError);

  const second = await members.createMember(member({ role: "owner" }));
  const demoted = await members.updateMember({ ...owner, role: "admin" });
  assert.equal(demoted.role, "admin", "with another owner in place, the first can step down");

  await assert.rejects(members.deleteMember(orgA, second.id), LastOwnerError);
});

test("an invitation is claimed once, by one user, and becomes active", async () => {
  const members = new InMemoryMembershipRepository();
  const invitation = await members.createMember(member({ userId: undefined, status: "invited", email: "new@example.test" }));
  const user = "22222222-0000-4000-8000-000000000001" as UserId;

  assert.deepEqual((await members.findInvitationsForEmail("NEW@example.test")).map((entry) => entry.id), [invitation.id]);

  const claimed = await members.claimInvitation(invitation.id, user, now);
  assert.equal(claimed?.status, "active");
  assert.equal(claimed?.userId, user);

  assert.equal(await members.claimInvitation(invitation.id, "33333333-0000-4000-8000-000000000001" as UserId, now), null);
  assert.deepEqual(await members.findInvitationsForEmail("new@example.test"), []);
});

test("only an invitation may exist without a user", async () => {
  const members = new InMemoryMembershipRepository();
  await assert.rejects(members.createMember(member({ userId: undefined, status: "active" })), /only an invitation/);
});

test("a workspace grant is set once per member and workspace, changed in place, and revoked", async () => {
  const members = new InMemoryMembershipRepository();
  const bob = await members.createMember(member());

  const grant = {
    id: "44444444-0000-4000-8000-000000000001" as WorkspaceMemberId,
    organizationId: orgA,
    workspaceId: finance,
    memberId: bob.id,
    access: "viewer" as const,
    createdAt: now,
    updatedAt: now,
  };

  await members.grantWorkspace(grant);
  await members.grantWorkspace({ ...grant, id: "44444444-0000-4000-8000-000000000002" as WorkspaceMemberId, access: "member" });

  const grants = await members.listWorkspaceGrantsForMember(orgA, bob.id);
  assert.equal(grants.length, 1);
  assert.equal(grants[0]!.access, "member");
  assert.equal(grants[0]!.id, grant.id, "the grant keeps its identity");
  assert.deepEqual(await members.listWorkspaceGrantsForMember(orgB, bob.id), []);

  await members.revokeWorkspace(orgA, finance, bob.id);
  assert.deepEqual(await members.listWorkspaceGrantsForMember(orgA, bob.id), []);
});

test("removing a member takes their workspace grants with them", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(member({ role: "owner" }));
  const bob = await members.createMember(member());

  await members.grantWorkspace({
    id: "44444444-0000-4000-8000-000000000003" as WorkspaceMemberId,
    organizationId: orgA,
    workspaceId: finance,
    memberId: bob.id,
    access: "member",
    createdAt: now,
    updatedAt: now,
  });

  await members.deleteMember(orgA, bob.id);

  assert.equal(await members.findMember(orgA, bob.id), null);
  assert.deepEqual(await members.listWorkspaceGrants(orgA), []);
});
