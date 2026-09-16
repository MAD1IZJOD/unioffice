import assert from "node:assert/strict";
import test from "node:test";

import type { ConnectionId } from "@unioffice/core";

import {
  ConnectionRateLimiter,
  ConnectorError,
  parseCredentials,
  serializeCredentials,
} from "@unioffice/connect";

import type { ToolExecutionContext } from "@unioffice/tools";

import { ConnectionResolver } from "./connection-resolver.js";
import {
  connectionIdFrom,
  connectionsSetup,
  finance,
  legal,
  orgA,
  orgB,
  SECRETS,
} from "./connections.fixture.js";

function context(overrides: Partial<ToolExecutionContext> = {}, workspaceId?: string): ToolExecutionContext {
  return {
    organizationId: orgA,
    agentId: "agent-1",
    workId: "work-1",
    taskId: "task-1",
    authorizedToolIds: [],
    metadata: workspaceId ? { workspaceId } : {},
    ...overrides,
  };
}

const githubRead = { provider: "github", capability: "github.read" } as const;
const githubWrite = { provider: "github", capability: "github.write" } as const;
const driveRead = { provider: "google_drive", capability: "drive.read" } as const;

async function resolverSetup(limiter?: ConnectionRateLimiter) {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const resolver = new ConnectionResolver(setup.connections, setup.providers, setup.recorder, limiter);
  return { ...setup, owner, resolver };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "none";
  } catch (error) {
    assert.ok(error instanceof ConnectorError, String(error));
    return error.code;
  }
}

test("a tool gets the organization's own token for one call", async () => {
  const setup = await resolverSetup();
  connectionIdFrom(await setup.connect(setup.owner, "github"));

  const token = await setup.resolver.use(context(), githubRead, async ({ accessToken }) => accessToken);

  assert.match(token, /^gho_ACCESS_TOKEN_DO_NOT_LEAK-/);
});

test("without a connection, or in another organization, nothing runs", async () => {
  const setup = await resolverSetup();
  connectionIdFrom(await setup.connect(setup.owner, "github"));
  let ran = false;
  const run = async () => { ran = true; };

  assert.equal(await codeOf(setup.resolver.use(context({ organizationId: orgB }), githubRead, run)), "not_connected");
  assert.equal(await codeOf(setup.resolver.use(context(), driveRead, run)), "not_connected");
  assert.equal(ran, false);
});

test("a capability the connection does not allow is refused before the token is opened", async () => {
  const setup = await resolverSetup();
  connectionIdFrom(await setup.connect(setup.owner, "github"));
  let ran = false;

  assert.equal(await codeOf(setup.resolver.use(context(), githubWrite, async () => { ran = true; })), "capability_disabled");
  assert.equal(ran, false);
});

test("a workspace's own connection is used there, the company-wide one elsewhere, and never another workspace's", async () => {
  const setup = await resolverSetup();
  const companyWide = connectionIdFrom(await setup.connect(setup.owner, "github"));
  const financeOnly = connectionIdFrom(await setup.connect(setup.owner, "github", { workspaceId: finance }));

  const used: string[] = [];
  const which = async ({ accessToken }: { accessToken: string }) => { used.push(accessToken); };

  await setup.resolver.use(context({}, finance), githubRead, which);
  await setup.resolver.use(context({}, legal), githubRead, which);
  await setup.resolver.use(context(), githubRead, which);

  const tokenOf = (id: string) => parseCredentials(setup.cipher.open(setup.connections.credentials.get(id as ConnectionId)!, `connection:${id}`)).accessToken;
  assert.deepEqual(used, [tokenOf(financeOnly), tokenOf(companyWide), tokenOf(companyWide)]);

  // With only a workspace connection, other workspaces have none.
  await setup.service.disconnect(setup.owner, companyWide as ConnectionId);
  assert.equal(await codeOf(setup.resolver.use(context({}, legal), githubRead, which)), "not_connected");
});

test("after a disconnect the very next call fails, even one already under way", async () => {
  const setup = await resolverSetup();
  const id = connectionIdFrom(await setup.connect(setup.owner, "github")) as ConnectionId;

  await setup.service.disconnect(setup.owner, id);

  let ran = false;
  assert.equal(await codeOf(setup.resolver.use(context(), githubRead, async () => { ran = true; })), "not_connected");
  assert.equal(ran, false);
});

test("a token GitHub refuses marks the connection for a person and is not retried", async () => {
  const setup = await resolverSetup();
  const id = connectionIdFrom(await setup.connect(setup.owner, "github")) as ConnectionId;
  let calls = 0;

  const code = await codeOf(setup.resolver.use(context(), githubRead, async () => {
    calls += 1;
    throw new ConnectorError("token_revoked");
  }));

  assert.equal(code, "token_revoked");
  assert.equal(calls, 1);

  const connection = (await setup.connections.find(orgA, id))!;
  assert.equal(connection.status, "needs_attention");
  assert.equal(connection.lastErrorCode, "token_revoked");

  const event = setup.events.at(-1)!;
  assert.equal(event.type, "connection.needs_attention");
  assert.equal(event.taskId, "task-1");
  assert.doesNotMatch(JSON.stringify(event), /DO_NOT_LEAK/);

  // Nothing is sent to GitHub again until someone reconnects.
  let ran = false;
  assert.equal(await codeOf(setup.resolver.use(context(), githubRead, async () => { ran = true; })), "token_revoked");
  assert.equal(ran, false);
});

test("an expiring Drive token is refreshed and stored sealed before the call", async () => {
  const setup = await resolverSetup();
  const id = connectionIdFrom(await setup.connect(setup.owner, "google_drive")) as ConnectionId;

  const sealed = setup.connections.credentials.get(id)!;
  const credentials = parseCredentials(setup.cipher.open(sealed, `connection:${id}`));
  setup.connections.credentials.set(id, setup.cipher.seal(serializeCredentials({ ...credentials, expiresAt: Date.now() + 5_000 }), `connection:${id}`));

  const token = await setup.resolver.use(context(), driveRead, async ({ accessToken }) => accessToken);

  assert.equal(setup.drive.refreshes, 1);
  assert.match(token, /refreshed-1$/);
  const stored = setup.connections.credentials.get(id)!;
  assert.doesNotMatch(stored, /DO_NOT_LEAK/);
  assert.match(setup.cipher.open(stored, `connection:${id}`), /refreshed-1/);
});

test("a Drive token refused mid-call is refreshed and tried once more, then given up on", async () => {
  const setup = await resolverSetup();
  const id = connectionIdFrom(await setup.connect(setup.owner, "google_drive")) as ConnectionId;
  let calls = 0;

  const ok = await setup.resolver.use(context(), driveRead, async ({ accessToken }) => {
    calls += 1;
    if (calls === 1) throw new ConnectorError("token_revoked");
    return accessToken;
  });

  assert.equal(calls, 2);
  assert.match(ok, /refreshed/);

  setup.drive.failRefresh = new ConnectorError("token_revoked");
  calls = 0;
  assert.equal(await codeOf(setup.resolver.use(context(), driveRead, async () => {
    calls += 1;
    throw new ConnectorError("token_revoked");
  })), "token_revoked");

  assert.equal(calls, 1);
  assert.equal((await setup.connections.find(orgA, id))!.status, "needs_attention");
});

test("a connection used too often is stopped here before the provider", async () => {
  const setup = await resolverSetup(new ConnectionRateLimiter(2, 60_000));
  connectionIdFrom(await setup.connect(setup.owner, "github"));
  let calls = 0;
  const run = async () => { calls += 1; };

  await setup.resolver.use(context(), githubRead, run);
  await setup.resolver.use(context(), githubRead, run);
  assert.equal(await codeOf(setup.resolver.use(context(), githubRead, run)), "rate_limited");
  assert.equal(calls, 2);
});

test("use is recorded, coarsely", async () => {
  const setup = await resolverSetup();
  const id = connectionIdFrom(await setup.connect(setup.owner, "github")) as ConnectionId;

  await setup.resolver.use(context(), githubRead, async () => undefined);
  const first = (await setup.connections.find(orgA, id))!.lastUsedAt;
  assert.ok(first);

  await setup.resolver.use(context(), githubRead, async () => undefined);
  assert.equal((await setup.connections.find(orgA, id))!.lastUsedAt?.getTime(), first.getTime());
});

test("stored credentials that do not open are treated as a dead connection, not a crash", async () => {
  const setup = await resolverSetup();
  const id = connectionIdFrom(await setup.connect(setup.owner, "github")) as ConnectionId;
  setup.connections.credentials.set(id, "v1.garbage.garbage.garbage");

  assert.equal(await codeOf(setup.resolver.use(context(), githubRead, async () => SECRETS.accessToken)), "token_revoked");
});
