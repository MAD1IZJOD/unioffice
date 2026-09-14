import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId } from "@unioffice/core";

import { buildApiServer, type ApiServices } from "../server.js";

import { AccessError } from "./access-resolver.js";
import { StreamTickets } from "./stream-tickets.js";
import { signedIn, TEST_TOKEN } from "./testing.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;

function server(overrides: Partial<ApiServices> = {}) {
  const subscriptions: string[] = [];

  const services = {
    ...signedIn({ organizationId: orgA, role: "member", workspaces: { "f0000000-0000-4000-8000-00000000000f": "viewer" } }),
    streamTickets: new StreamTickets(),
    executionStream: {
      subscribe(organizationId: string) {
        subscriptions.push(organizationId);
        return { close() {} };
      },
    },
    healthCheck: async () => ({}),
    corsOrigins: [],
    ...overrides,
  } as unknown as ApiServices;

  return { app: buildApiServer(services), subscriptions };
}

const bearer = { authorization: `Bearer ${TEST_TOKEN}` };

test("/me says who is signed in, their role, what it allows and their workspace grants", async () => {
  const { app } = server();
  const response = await app.inject({ method: "GET", url: "/me", headers: bearer });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.user.email, "tester@example.test");
  assert.equal(body.standing, "active");
  assert.equal(body.organization.id, orgA);
  assert.equal(body.organization.role, "member");
  assert.ok(body.organization.permissions.includes("missions.create"));
  assert.ok(!body.organization.permissions.includes("members.manage"));
  assert.deepEqual(body.organization.workspaces, [{ workspaceId: "f0000000-0000-4000-8000-00000000000f", access: "viewer" }]);
  assert.deepEqual(body.memberships.map((member: { organizationId: string }) => member.organizationId), [orgA]);
});

test("/me answers someone who belongs nowhere, or is suspended, without an organization", async () => {
  const nowhere = server({ ...signedIn({}) });
  const lonely = (await nowhere.app.inject({ method: "GET", url: "/me", headers: bearer })).json();
  assert.equal(lonely.standing, "none");
  assert.equal(lonely.organization, null);

  const base = signedIn({ organizationId: orgA });
  const suspended = server({
    ...base,
    accessResolver: {
      ...base.accessResolver,
      async resolve() { throw new AccessError(403, "Your access to this organization is suspended."); },
    },
  });
  const body = (await suspended.app.inject({ method: "GET", url: "/me", headers: bearer })).json();
  assert.equal(body.standing, "suspended");
  assert.equal(body.organization, null);
});

test("/me about another organization gives nothing about it", async () => {
  const { app } = server();
  const body = (await app.inject({ method: "GET", url: `/me?organizationId=${orgB}`, headers: bearer })).json();

  assert.equal(body.organization, null);
  assert.equal(body.standing, "none");
});

test("/me still needs a valid session", async () => {
  const { app } = server();
  assert.equal((await app.inject({ method: "GET", url: "/me" })).statusCode, 401);
});

test("a stream ticket needs a session, and names the caller's organization", async () => {
  const tickets = new StreamTickets();
  const { app } = server({ streamTickets: tickets });

  assert.equal((await app.inject({ method: "POST", url: "/stream/tickets", payload: {} })).statusCode, 401);

  const issued = await app.inject({ method: "POST", url: "/stream/tickets", headers: bearer, payload: { organizationId: orgA } });
  assert.equal(issued.statusCode, 201);
  assert.equal(tickets.redeem(issued.json().ticket)?.organizationId, orgA);

  const foreign = await app.inject({ method: "POST", url: "/stream/tickets", headers: bearer, payload: { organizationId: orgB } });
  assert.equal(foreign.statusCode, 404);
});

test("the stream opens once with a ticket and no header, and refuses the ticket after that", async () => {
  const { app, subscriptions } = server();
  const issued = (await app.inject({ method: "POST", url: "/stream/tickets", headers: bearer, payload: {} })).json();
  const address = await app.listen({ port: 0, host: "127.0.0.1" });

  try {
    const controller = new AbortController();
    const opened = await fetch(`${address}/stream?ticket=${issued.ticket}`, { signal: controller.signal });
    assert.equal(opened.status, 200);
    controller.abort();
    assert.deepEqual(subscriptions, [orgA]);

    const replayed = await fetch(`${address}/stream?ticket=${issued.ticket}`);
    assert.equal(replayed.status, 401);

    const forged = await fetch(`${address}/stream?ticket=not-a-ticket`);
    assert.equal(forged.status, 401);

    const bare = await fetch(`${address}/stream`);
    assert.equal(bare.status, 401);
  } finally {
    await app.close();
  }
});
