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

import { InMemoryMembershipRepository } from "@unioffice/database";

import { AccessError, AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date("2026-09-14T12:00:00.000Z");

const userA: Identity = { userId: "11111111-0000-4000-8000-00000000000a" as UserId, email: "a@example.test", emailConfirmed: true };
const userB: Identity = { userId: "11111111-0000-4000-8000-00000000000b" as UserId, email: "b@example.test", emailConfirmed: true };

let counter = 0;

function row(identity: Identity | undefined, overrides: Partial<OrganizationMember>): OrganizationMember {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}` as MemberId,
    organizationId: orgA,
    userId: identity?.userId,
    email: identity?.email ?? `invited${counter}@example.test`,
    role: "member",
    status: "active",
    createdAt: new Date(now.getTime() + counter),
    updatedAt: now,
    ...overrides,
  };
}

async function rejectsWith(promise: Promise<unknown>, statusCode: number) {
  await assert.rejects(promise, (error: unknown) =>
    error instanceof AccessError && error.statusCode === statusCode);
}

test("an active member gets their role and workspace grants in that organization", async () => {
  const members = new InMemoryMembershipRepository();
  const member = await members.createMember(row(userB, { role: "member" }));
  await members.grantWorkspace({
    id: "44444444-0000-4000-8000-000000000001" as WorkspaceMemberId,
    organizationId: orgA,
    workspaceId: finance,
    memberId: member.id,
    access: "viewer",
    createdAt: now,
    updatedAt: now,
  });

  const access = await new AccessResolver(members).resolve(userB, orgA);

  assert.equal(access.organizationId, orgA);
  assert.equal(access.memberId, member.id);
  assert.equal(access.role, "member");
  assert.equal(access.workspaces.get(finance), "viewer");
});

test("another organization, a made-up one and a malformed id all read as not found", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(row(userA, { role: "owner" }));
  await members.createMember(row(userB, { organizationId: orgB, role: "owner" }));
  const resolver = new AccessResolver(members);

  await rejectsWith(resolver.resolve(userA, orgB), 404);
  await rejectsWith(resolver.resolve(userA, "cccccccc-0000-4000-8000-000000000003"), 404);
  await rejectsWith(resolver.resolve(userA, "' or 1=1 --"), 404);
});

test("a suspended member is refused, and the suspension applies on the very next request", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(row(userA, { role: "owner" }));
  const b = await members.createMember(row(userB, {}));
  const resolver = new AccessResolver(members);

  assert.equal((await resolver.resolve(userB, orgA)).role, "member");

  await members.updateMember({ ...b, status: "suspended", updatedAt: now });
  await rejectsWith(resolver.resolve(userB, orgA), 403);
});

test("a role change and a revoked grant are seen on the next request", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(row(userA, { role: "owner" }));
  const b = await members.createMember(row(userB, { role: "admin" }));
  await members.grantWorkspace({
    id: "44444444-0000-4000-8000-000000000002" as WorkspaceMemberId,
    organizationId: orgA,
    workspaceId: finance,
    memberId: b.id,
    access: "member",
    createdAt: now,
    updatedAt: now,
  });
  const resolver = new AccessResolver(members);

  await members.updateMember({ ...b, role: "viewer", updatedAt: now });
  await members.revokeWorkspace(orgA, finance, b.id);

  const access = await resolver.resolve(userB, orgA);
  assert.equal(access.role, "viewer");
  assert.equal(access.workspaces.size, 0);
});

test("a confirmed email picks up its invitation on first sign-in", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(row(undefined, { email: userB.email, status: "invited", role: "viewer" }));

  const access = await new AccessResolver(members, () => now).resolve(userB, orgA);

  assert.equal(access.role, "viewer");
  assert.equal((await members.findMemberByUser(orgA, userB.userId))?.status, "active");
});

test("an unconfirmed email cannot claim an invitation sent to that address", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(row(undefined, { email: userB.email, status: "invited" }));

  await rejectsWith(new AccessResolver(members).resolve({ ...userB, emailConfirmed: false }, orgA), 404);
  assert.equal((await members.findInvitationsForEmail(userB.email)).length, 1);
});

test("without an organization named, the oldest active membership is used", async () => {
  const members = new InMemoryMembershipRepository();
  await members.createMember(row(userA, { organizationId: orgB, status: "suspended", role: "admin" }));
  await members.createMember(row(userA, { organizationId: orgA, role: "owner" }));

  const access = await new AccessResolver(members).resolve(userA);
  assert.equal(access.organizationId, orgA);
});

test("someone with no membership anywhere is refused", async () => {
  await rejectsWith(new AccessResolver(new InMemoryMembershipRepository()).resolve(userA), 404);
});
