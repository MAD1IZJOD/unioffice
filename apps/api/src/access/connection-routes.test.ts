import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationRole, WorkspaceAccessLevel, WorkspaceId } from "@unioffice/core";

import { hashOAuthState } from "@unioffice/connect";

import {
  connectionIdFrom,
  connectionsSetup,
  finance,
  orgA,
  orgB,
  SECRETS,
} from "../connections/connections.fixture.js";
import { buildApiServer, redactUrl, type ApiServices } from "../server.js";

import { AccessResolver } from "./access-resolver.js";
import type { Identity } from "./authenticator.js";
import { StreamTickets } from "./stream-tickets.js";

/**
 * Connections over HTTP, with the real membership resolver and the real
 * connection service - only storage and the provider are stand-ins.
 */
async function company() {
  const setup = await connectionsSetup();
  const identities = new Map<string, Identity>();

  async function person(name: string, role: OrganizationRole, organizationId = orgA, grants: Array<[WorkspaceId, WorkspaceAccessLevel]> = []) {
    const access = await setup.person(role, organizationId, grants);

    for (const [workspaceId, level] of grants) {
      await setup.members.grantWorkspace({
        id: `44444444-0000-4000-8000-${access.memberId.slice(-12)}` as never,
        organizationId,
        workspaceId,
        memberId: access.memberId,
        access: level,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    identities.set(`token-${name}`, { userId: access.userId, email: access.email, emailConfirmed: true });
    return access;
  }

  const owner = await person("owner", "owner");
  await person("admin", "admin");
  await person("member", "member");
  await person("viewer", "viewer");
  await person("outsider", "owner", orgB);

  const app = buildApiServer({
    authenticator: { verify: async (token: string) => identities.get(token) ?? null },
    accessResolver: new AccessResolver(setup.members),
    streamTickets: new StreamTickets(),
    connectionService: setup.service,
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices);

  const request = (method: "GET" | "POST", name: string | null, url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: name ? { authorization: `Bearer token-${name}` } : {},
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  return { setup, owner, app, request };
}

function noSecrets(body: string) {
  for (const secret of Object.values(SECRETS)) {
    assert.equal(body.includes(secret), false, `response leaked ${secret}`);
  }

  assert.doesNotMatch(body, /credentials|codeVerifier|accessToken|refreshToken|clientSecret/);
}

test("reading connections needs a session and a membership", async () => {
  const { request } = await company();

  assert.equal((await request("GET", null, "/connections")).statusCode, 401);
  assert.equal((await request("GET", "viewer", "/connections")).statusCode, 200);
  assert.equal((await request("GET", "outsider", `/connections?organizationId=${orgA}`)).statusCode, 404);
});

test("only owners and admins can start a connection", async () => {
  const { request } = await company();

  assert.equal((await request("POST", "member", "/connections/github/authorize", {})).statusCode, 403);
  assert.equal((await request("POST", "viewer", "/connections/github/authorize", {})).statusCode, 403);

  const started = await request("POST", "admin", "/connections/github/authorize", {});
  assert.equal(started.statusCode, 200);
  assert.ok(started.json().authorizationUrl.startsWith("https://provider.test/github/authorize"));
  noSecrets(started.body);

  assert.equal((await request("POST", "owner", "/connections/dropbox/authorize", {})).statusCode, 400);
});

test("the authorize route refuses fields it does not take", async () => {
  const { request } = await company();

  const smuggled = await request("POST", "owner", "/connections/github/authorize", { userId: "someone-else", scopes: ["admin:org"] });
  assert.equal(smuggled.statusCode, 400);
});

test("the callback works without a session, redirects, and never echoes what came in", async () => {
  const { request, setup } = await company();

  const started = await request("POST", "owner", "/connections/github/authorize", {});
  const state = new URL(started.json().authorizationUrl).searchParams.get("state")!;

  const callback = await request("GET", null, `/connections/oauth/github/callback?code=${SECRETS.code}&state=${state}`);

  assert.equal(callback.statusCode, 303);
  assert.equal(callback.headers["cache-control"], "no-store");
  const location = String(callback.headers.location);
  connectionIdFrom(location);
  noSecrets(location + callback.body);
  assert.equal(location.includes(state), false);

  const replay = await request("GET", null, `/connections/oauth/github/callback?code=${SECRETS.code}&state=${state}`);
  assert.equal(replay.headers.location, "http://localhost:5173/settings/connections?error=oauth_state_invalid");

  const forged = await request("GET", null, `/connections/oauth/github/callback?code=x&state=${"a".repeat(43)}&error=<script>`);
  assert.equal(forged.statusCode, 303);
  assert.equal(forged.headers.location, "http://localhost:5173/settings/connections?error=oauth_state_invalid");

  assert.equal(setup.connections.connections.size, 1);
  assert.equal(setup.connections.states.has(hashOAuthState(state)), false);
});

test("a connection's detail carries nothing secret, and another organization cannot reach it", async () => {
  const { request, setup, owner } = await company();
  const id = connectionIdFrom(await setup.connect(owner, "google_drive"));

  const list = await request("GET", "viewer", "/connections");
  const detail = await request("GET", "owner", `/connections/${id}`);

  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().connection.account, "person@company.test");
  noSecrets(list.body + detail.body);

  assert.equal((await request("GET", "outsider", `/connections/${id}`)).statusCode, 404);
  assert.equal((await request("POST", "outsider", `/connections/${id}/disconnect`, {})).statusCode, 404);
  assert.equal((await request("POST", "outsider", `/connections/${id}/capabilities`, { capabilities: [] })).statusCode, 404);
  assert.equal((await request("GET", "owner", "/connections/not-a-uuid")).statusCode, 400);
});

test("capabilities change only through their own field, and only for managers", async () => {
  const { request, setup, owner } = await company();
  const id = connectionIdFrom(await setup.connect(owner, "github"));

  assert.equal((await request("POST", "member", `/connections/${id}/capabilities`, { capabilities: ["github.read"] })).statusCode, 403);

  const massAssigned = await request("POST", "owner", `/connections/${id}/capabilities`, {
    capabilities: ["github.read"],
    status: "active",
    organizationId: orgA,
    scopes: ["repo"],
  });
  assert.equal(massAssigned.statusCode, 400);

  const changed = await request("POST", "owner", `/connections/${id}/capabilities`, { capabilities: ["github.read", "github.write"] });
  assert.equal(changed.statusCode, 200);
  assert.deepEqual(changed.json().connection.capabilities, ["github.read", "github.write"]);
});

test("disconnecting over HTTP revokes, and a second attempt is a conflict", async () => {
  const { request, setup, owner } = await company();
  const id = connectionIdFrom(await setup.connect(owner, "github"));

  assert.equal((await request("POST", "viewer", `/connections/${id}/disconnect`, {})).statusCode, 403);

  const disconnected = await request("POST", "admin", `/connections/${id}/disconnect`, {});
  assert.equal(disconnected.statusCode, 200);
  assert.equal(disconnected.json().connection.status, "revoked");
  assert.equal(disconnected.json().providerRevoked, true);
  noSecrets(disconnected.body);

  assert.equal((await request("POST", "admin", `/connections/${id}/disconnect`, {})).statusCode, 409);
});

test("a workspace connection is invisible to a member without the workspace", async () => {
  const { request, setup, owner } = await company();
  const id = connectionIdFrom(await setup.connect(owner, "github", { workspaceId: finance }));

  assert.equal((await request("GET", "member", `/connections/${id}`)).statusCode, 404);
  assert.deepEqual((await request("GET", "member", "/connections")).json().connections, []);
});

test("credential-like query values never reach a log line", () => {
  assert.equal(
    redactUrl(`/connections/oauth/github/callback?code=${SECRETS.code}&state=abc&x=1`),
    "/connections/oauth/github/callback?code=%5Bredacted%5D&state=%5Bredacted%5D&x=1",
  );
  assert.equal(redactUrl("/stream?ticket=secret-ticket"), "/stream?ticket=%5Bredacted%5D");
  assert.equal(redactUrl("/connections"), "/connections");
});
