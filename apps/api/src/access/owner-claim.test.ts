import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, UserId } from "@unioffice/core";

import { InMemoryMembershipRepository } from "@unioffice/database";

import type { RecordEventInput } from "../event-recorder.js";

import { claimOwnership, OwnerClaimError, type UserDirectory } from "./owner-claim.js";

const org = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const now = new Date("2026-09-14T12:00:00.000Z");
const ownerId = "11111111-0000-4000-8000-00000000000a" as UserId;

function setup(users: Record<string, { id: UserId; emailConfirmed: boolean }> = {}) {
  const members = new InMemoryMembershipRepository();
  const events: RecordEventInput[] = [];
  const directory: UserDirectory = { findByEmail: async (email) => users[email] ?? null };
  const eventRecorder = { record: async (event: RecordEventInput) => { events.push(event); return event as never; } };

  const claim = (email: string) =>
    claimOwnership({ members, users: directory, eventRecorder, organizationId: org, email, now });

  return { members, events, claim };
}

test("someone who has signed in with a confirmed email becomes the active owner", async () => {
  const { claim, members, events } = setup({ "owner@example.test": { id: ownerId, emailConfirmed: true } });

  const result = await claim("  Owner@Example.test ");

  assert.equal(result.outcome, "added");
  assert.equal(result.member.role, "owner");
  assert.equal(result.member.status, "active");
  assert.equal((await members.findMemberByUser(org, ownerId))?.role, "owner");
  assert.equal(events[0]?.type, "member.added");
  assert.doesNotMatch(JSON.stringify(events[0]?.payload), /example\.test/, "the audit line names the member, not their address");
});

test("someone who has not signed in yet gets an owner invitation, not access", async () => {
  const { claim } = setup();

  const result = await claim("owner@example.test");

  assert.equal(result.outcome, "invited");
  assert.equal(result.member.status, "invited");
  assert.equal(result.member.userId, undefined);
});

test("an unconfirmed address is treated as not signed in", async () => {
  const { claim } = setup({ "owner@example.test": { id: ownerId, emailConfirmed: false } });

  const result = await claim("owner@example.test");

  assert.equal(result.outcome, "invited");
  assert.equal(result.member.userId, undefined);
});

test("an existing member is promoted, once, and a repeat run changes nothing", async () => {
  const { claim, members } = setup({ "owner@example.test": { id: ownerId, emailConfirmed: true } });
  await members.createMember({
    id: "00000000-0000-4000-8000-000000000001" as never,
    organizationId: org,
    userId: ownerId,
    email: "owner@example.test",
    role: "viewer",
    status: "suspended",
    createdAt: now,
    updatedAt: now,
  });

  assert.equal((await claim("owner@example.test")).outcome, "promoted");
  assert.equal((await claim("owner@example.test")).outcome, "already_owner");
  assert.equal((await members.findMemberByUser(org, ownerId))?.status, "active");
});

test("an organization that already has an owner cannot be claimed by anyone else", async () => {
  const { claim } = setup({
    "owner@example.test": { id: ownerId, emailConfirmed: true },
    "intruder@example.test": { id: "11111111-0000-4000-8000-00000000000b" as UserId, emailConfirmed: true },
  });
  await claim("owner@example.test");

  await assert.rejects(claim("intruder@example.test"), OwnerClaimError);
});

test("something that is not an email address is refused", async () => {
  const { claim } = setup();
  await assert.rejects(claim("not-an-email"), OwnerClaimError);
});
