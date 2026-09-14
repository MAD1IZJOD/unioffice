import assert from "node:assert/strict";
import test from "node:test";

import type { UserId } from "@unioffice/core";

import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

const identity: Identity = { userId: "user-a" as UserId, email: "a@example.test", emailConfirmed: true };

test("a ticket names its holder and organization, and works exactly once", () => {
  const tickets = new StreamTickets();
  const { ticket } = tickets.issue(identity, "org-a");

  assert.deepEqual(tickets.redeem(ticket), { identity, organizationId: "org-a" });
  assert.equal(tickets.redeem(ticket), null);
});

test("an expired ticket does not work", () => {
  let now = 1_000;
  const tickets = new StreamTickets({ ttlMs: 60_000, now: () => now });
  const { ticket } = tickets.issue(identity, "org-a");

  now += 60_000;
  assert.equal(tickets.redeem(ticket), null);
});

test("a made-up, empty or oversized ticket does not work", () => {
  const tickets = new StreamTickets();
  tickets.issue(identity, "org-a");

  assert.equal(tickets.redeem("made-up"), null);
  assert.equal(tickets.redeem(""), null);
  assert.equal(tickets.redeem("x".repeat(500)), null);
});

test("tickets are unguessable and distinct", () => {
  const tickets = new StreamTickets();
  const first = tickets.issue(identity, "org-a").ticket;
  const second = tickets.issue(identity, "org-a").ticket;

  assert.notEqual(first, second);
  assert.ok(first.length >= 43);
});

test("the store stays bounded", () => {
  const tickets = new StreamTickets({ maxTickets: 2 });
  const first = tickets.issue(identity, "org-a").ticket;
  tickets.issue(identity, "org-a");
  tickets.issue(identity, "org-a");

  assert.equal(tickets.redeem(first), null, "the oldest ticket made room");
});
