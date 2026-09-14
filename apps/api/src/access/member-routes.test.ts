import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemberId,
  OrganizationId,
  OrganizationRole,
  UserId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryMembershipRepository } from "@unioffice/database";

import { buildApiServer, type ApiServices } from "../server.js";

import { AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { MemberService } from "./member-service.js";
import { StreamTickets } from "./stream-tickets.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const now = new Date("2026-09-14T12:00:00.000Z");

/**
 * The real membership rules end to end over HTTP: a token per person, the real
 * resolver and the real member service, only the storage in memory.
 */
async function company() {
  const members = new InMemoryMembershipRepository();
  const identities = new Map<string, Identity>();
  const ids = new Map<string, MemberId>();
  let counter = 0;

  async function add(name: string, organizationId: OrganizationId, role: OrganizationRole) {
    counter += 1;
    const suffix = String(counter).padStart(12, "0");
    const identity: Identity = {
      userId: `11111111-0000-4000-8000-${suffix}` as UserId,
      email: `${name}@example.test`,
      emailConfirmed: true,
    };
    const member = await members.createMember({
      id: `00000000-0000-4000-8000-${suffix}` as MemberId,
      organizationId,
      userId: identity.userId,
      email: identity.email,
      role,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    identities.set(`token-${name}`, identity);
    ids.set(name, member.id);
  }

  await add("owner", orgA, "owner");
  await add("admin", orgA, "admin");
  await add("member", orgA, "member");
  await add("viewer", orgA, "viewer");
  await add("outsider", orgB, "owner");
  await add("theirs", orgB, "member");

  const services = {
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: new AccessResolver(members, () => now),
    streamTickets: new StreamTickets(),
    memberService: new MemberService(
      members,
      { findById: async (id: WorkspaceId) => (id === finance ? ({ id, organizationId: orgA } as Workspace) : null) },
      { record: async () => ({}) as never },
      () => now,
    ),
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const as = (name: string) => ({ authorization: `Bearer token-${name}` });
  const id = (name: string) => ids.get(name)!;

  return { app, as, id, members };
}

test("every member can list the organization's members; nobody else's appear", async () => {
  const { app, as } = await company();

  const response = await app.inject({ method: "GET", url: "/members", headers: as("viewer") });

  assert.equal(response.statusCode, 200);
  const emails = response.json().members.map((member: { email: string }) => member.email).sort();
  assert.deepEqual(emails, ["admin@example.test", "member@example.test", "owner@example.test", "viewer@example.test"]);
});

test("a viewer or member trying to manage people is forbidden", async () => {
  const { app, as, id } = await company();

  for (const name of ["viewer", "member"]) {
    const invite = await app.inject({ method: "POST", url: "/members", headers: as(name), payload: { email: "x@example.test", role: "viewer" } });
    const suspend = await app.inject({ method: "POST", url: `/members/${id("admin")}/suspend`, headers: as(name), payload: {} });

    assert.equal(invite.statusCode, 403, name);
    assert.equal(invite.json().error.code, "FORBIDDEN");
    assert.equal(suspend.statusCode, 403, name);
  }
});

test("an admin cannot demote the owner or promote anyone to admin or owner", async () => {
  const { app, as, id } = await company();

  const demoteOwner = await app.inject({ method: "POST", url: `/members/${id("owner")}/role`, headers: as("admin"), payload: { role: "viewer" } });
  const raiseMember = await app.inject({ method: "POST", url: `/members/${id("member")}/role`, headers: as("admin"), payload: { role: "owner" } });
  const raiseSelf = await app.inject({ method: "POST", url: `/members/${id("admin")}/role`, headers: as("admin"), payload: { role: "owner" } });
  const removeOwner = await app.inject({ method: "POST", url: `/members/${id("owner")}/remove`, headers: as("admin"), payload: {} });

  assert.equal(demoteOwner.statusCode, 403);
  assert.equal(raiseMember.statusCode, 403);
  assert.equal(raiseSelf.statusCode, 409);
  assert.equal(removeOwner.statusCode, 403);
});

test("an invitation takes only an email and a role; status, user and organization in the body are ignored", async () => {
  const { app, as, members } = await company();

  const response = await app.inject({
    method: "POST",
    url: "/members",
    headers: as("owner"),
    payload: {
      email: "new@example.test",
      role: "member",
      status: "active",
      userId: "11111111-0000-4000-8000-000000000999",
      organizationId: orgA,
      invitedBy: "someone-else",
    },
  });

  assert.equal(response.statusCode, 201);
  const created = await members.findMember(orgA, response.json().member.id);
  assert.equal(created?.status, "invited");
  assert.equal(created?.userId, undefined);
});

test("a member of another organization cannot be reached by id, and a forged organization is not found", async () => {
  const { app, as, id } = await company();

  const foreign = await app.inject({ method: "POST", url: `/members/${id("theirs")}/suspend`, headers: as("owner"), payload: {} });
  const intoTheirs = await app.inject({ method: "GET", url: `/members?organizationId=${orgB}`, headers: as("owner") });
  const malformed = await app.inject({ method: "POST", url: "/members/not-an-id/remove", headers: as("owner"), payload: {} });

  assert.equal(foreign.statusCode, 404);
  assert.equal(intoTheirs.statusCode, 404);
  assert.equal(malformed.statusCode, 400);
});

test("the owner can suspend a member, whose very next request is refused", async () => {
  const { app, as, id } = await company();

  const before = await app.inject({ method: "GET", url: "/members", headers: as("member") });
  assert.equal(before.statusCode, 200);

  const suspended = await app.inject({ method: "POST", url: `/members/${id("member")}/suspend`, headers: as("owner"), payload: {} });
  assert.equal(suspended.statusCode, 200);

  const after = await app.inject({ method: "GET", url: "/members", headers: as("member") });
  assert.equal(after.statusCode, 403);
});

test("an admin grants workspace access; an invalid level or someone else's workspace is refused", async () => {
  const { app, as, id } = await company();

  const granted = await app.inject({ method: "POST", url: `/members/${id("member")}/workspaces`, headers: as("admin"), payload: { workspaceId: finance, access: "member" } });
  assert.equal(granted.statusCode, 200);
  assert.deepEqual(granted.json().member.workspaces, [{ workspaceId: finance, access: "member" }]);

  const missingLevel = await app.inject({ method: "POST", url: `/members/${id("member")}/workspaces`, headers: as("admin"), payload: { workspaceId: finance } });
  assert.equal(missingLevel.statusCode, 400);

  const unknown = await app.inject({ method: "POST", url: `/members/${id("member")}/workspaces`, headers: as("admin"), payload: { workspaceId: "f0000000-0000-4000-8000-0000000000bb", access: "member" } });
  assert.equal(unknown.statusCode, 400);

  const byMember = await app.inject({ method: "POST", url: `/members/${id("viewer")}/workspaces`, headers: as("member"), payload: { workspaceId: finance, access: "member" } });
  assert.equal(byMember.statusCode, 403);
});
