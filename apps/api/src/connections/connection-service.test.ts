import assert from "node:assert/strict";
import test from "node:test";

import type { ConnectionId } from "@unioffice/core";

import { hashOAuthState } from "@unioffice/connect";

import { AccessError } from "../access/access-resolver.js";

import {
  ConnectionNotFoundError,
  ConnectionStateError,
  ConnectionValidationError,
} from "./connection-service.js";
import {
  connectionIdFrom,
  connectionsSetup,
  finance,
  legal,
  orgB,
  SECRETS,
  theirWorkspace,
} from "./connections.fixture.js";

function assertNoSecrets(value: unknown, label: string) {
  const text = JSON.stringify(value);

  for (const [name, secret] of Object.entries(SECRETS)) {
    assert.equal(text.includes(secret), false, `${label} must not contain the ${name}`);
  }
}

test("connecting stores sealed credentials and shows people nothing secret", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");

  const redirect = await setup.connect(owner, "github");
  const id = connectionIdFrom(redirect) as ConnectionId;

  assert.ok(redirect.startsWith("http://localhost:5173/settings/connections/"));
  assertNoSecrets(redirect, "the redirect");

  const sealed = setup.connections.credentials.get(id)!;
  assertNoSecrets(sealed, "the stored credentials");
  assert.match(setup.cipher.open(sealed, `connection:${id}`), /gho_ACCESS_TOKEN/);

  const view = await setup.service.get(owner, id);
  assert.equal(view.status, "active");
  assert.equal(view.account, "octo-dev");
  assert.equal(view.connectedBy, owner.email);
  assert.deepEqual(view.capabilities, ["github.read"], "a new connection allows reads only");
  assertNoSecrets(view, "the connection view");
  assertNoSecrets(await setup.service.overview(owner), "the overview");
  assertNoSecrets(setup.events, "the event log");

  assert.equal(setup.events.at(-1)?.type, "connection.connected");
});

test("the authorization URL carries a state that is stored only as a hash, with a sealed verifier", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");

  const { authorizationUrl } = await setup.service.startAuthorization(owner, { provider: "github", workspaceId: undefined, repositoryAccess: "private" });
  const url = new URL(authorizationUrl);
  const state = url.searchParams.get("state")!;

  assert.equal(url.searchParams.get("scope"), "repo");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:4000/connections/oauth/github/callback");
  assert.equal(setup.connections.states.has(state), false);

  const record = setup.connections.states.get(hashOAuthState(state))!;
  assert.equal(record.userId, owner.userId);
  assert.notEqual(record.codeVerifier.length, 0);
  assert.equal(url.toString().includes(record.codeVerifier), false);
});

test("a state completes at most once", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");

  const { authorizationUrl } = await setup.service.startAuthorization(owner, { provider: "github", workspaceId: undefined, repositoryAccess: undefined });
  const state = new URL(authorizationUrl).searchParams.get("state")!;

  connectionIdFrom(await setup.service.completeAuthorization("github", { code: SECRETS.code, state }));

  assert.equal(
    await setup.service.completeAuthorization("github", { code: SECRETS.code, state }),
    "http://localhost:5173/settings/connections?error=oauth_state_invalid",
  );
  assert.equal(setup.github.exchanges, 1);
});

test("forged, missing, expired and cross-provider states are refused before any exchange", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const invalid = "http://localhost:5173/settings/connections?error=oauth_state_invalid";

  assert.equal(await setup.service.completeAuthorization("github", { code: SECRETS.code }), invalid);
  assert.equal(await setup.service.completeAuthorization("github", { code: SECRETS.code, state: "x".repeat(43) }), invalid);
  assert.equal(await setup.service.completeAuthorization("github", { code: SECRETS.code, state: ["array"] }), invalid);

  // Started for Drive, returned on GitHub's callback.
  const drive = await setup.service.startAuthorization(owner, { provider: "google_drive", workspaceId: undefined, repositoryAccess: undefined });
  const driveState = new URL(drive.authorizationUrl).searchParams.get("state")!;
  assert.equal(await setup.service.completeAuthorization("github", { code: SECRETS.code, state: driveState }), invalid);

  const late = await setup.service.startAuthorization(owner, { provider: "github", workspaceId: undefined, repositoryAccess: undefined });
  setup.now.value = new Date(setup.now.value.getTime() + 11 * 60_000);
  assert.equal(
    await setup.service.completeAuthorization("github", { code: SECRETS.code, state: new URL(late.authorizationUrl).searchParams.get("state")! }),
    invalid,
  );

  assert.equal(await setup.service.completeAuthorization("not-a-provider", { code: SECRETS.code, state: "y".repeat(43) }), invalid);
  assert.equal(setup.github.exchanges + setup.drive.exchanges, 0);
  assert.equal(setup.connections.connections.size, 0);
});

test("someone demoted or suspended mid-flow cannot finish connecting", async () => {
  const setup = await connectionsSetup();
  const admin = await setup.person("admin");

  const { authorizationUrl } = await setup.service.startAuthorization(admin, { provider: "github", workspaceId: undefined, repositoryAccess: undefined });
  const member = (await setup.members.findMemberByUser(admin.organizationId, admin.userId))!;
  await setup.members.updateMember({ ...member, role: "member" });

  const redirect = await setup.service.completeAuthorization("github", {
    code: SECRETS.code,
    state: new URL(authorizationUrl).searchParams.get("state")!,
  });

  assert.match(redirect, /error=oauth_state_invalid$/);
  assert.equal(setup.github.exchanges, 0);
  assert.equal(setup.connections.connections.size, 0);
});

test("declining at the provider, a bad code or a narrower grant stores nothing", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");

  const declined = await setup.service.startAuthorization(owner, { provider: "github", workspaceId: undefined, repositoryAccess: undefined });
  assert.match(
    await setup.service.completeAuthorization("github", { error: "access_denied", state: new URL(declined.authorizationUrl).searchParams.get("state")! }),
    /error=oauth_denied$/,
  );

  assert.match(await setup.connect(owner, "github", { code: "wrong" }), /error=oauth_exchange_failed$/);

  setup.github.grantScopes = ["public_repo"];
  assert.match(await setup.connect(owner, "github", { repositoryAccess: "private" }), /error=scope_not_granted$/);
  assert.equal(setup.github.revoked.length, 1, "a token issued for a grant that is refused is revoked");

  assert.equal(setup.connections.connections.size, 0);
});

test("only owners and admins start a connection, and only where they can act", async () => {
  const setup = await connectionsSetup();
  const member = await setup.person("member", undefined, [[finance, "member"]]);
  const viewer = await setup.person("viewer");
  const admin = await setup.person("admin");

  await assert.rejects(setup.service.startAuthorization(member, { provider: "github", workspaceId: undefined, repositoryAccess: undefined }), AccessError);
  await assert.rejects(setup.service.startAuthorization(member, { provider: "github", workspaceId: finance, repositoryAccess: undefined }), AccessError);
  await assert.rejects(setup.service.startAuthorization(viewer, { provider: "github", workspaceId: undefined, repositoryAccess: undefined }), AccessError);

  await assert.rejects(setup.service.startAuthorization(admin, { provider: "dropbox", workspaceId: undefined, repositoryAccess: undefined }), ConnectionValidationError);
  await assert.rejects(setup.service.startAuthorization(admin, { provider: "google_drive", workspaceId: undefined, repositoryAccess: "private" }), ConnectionValidationError);
  await assert.rejects(setup.service.startAuthorization(admin, { provider: "github", workspaceId: theirWorkspace, repositoryAccess: undefined }), ConnectionNotFoundError);
  await assert.rejects(setup.service.startAuthorization(admin, { provider: "github", workspaceId: "not-a-uuid", repositoryAccess: undefined }), ConnectionValidationError);
});

test("an unconfigured server offers nothing to connect", async () => {
  const setup = await connectionsSetup({ configured: false });
  const owner = await setup.person("owner");

  await assert.rejects(setup.service.startAuthorization(owner, { provider: "github", workspaceId: undefined, repositoryAccess: undefined }), ConnectionStateError);

  const { providers } = await setup.service.overview(owner);
  assert.deepEqual(providers.map((entry) => [entry.provider, entry.configured]), [["github", false], ["google_drive", false]]);
});

test("another organization's connection reads as not found and cannot be changed", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const outsider = await setup.person("owner", orgB);

  const id = connectionIdFrom(await setup.connect(owner, "github")) as ConnectionId;

  await assert.rejects(setup.service.get(outsider, id), ConnectionNotFoundError);
  await assert.rejects(setup.service.disconnect(outsider, id), ConnectionNotFoundError);
  await assert.rejects(setup.service.setCapabilities(outsider, id, ["github.read"]), ConnectionNotFoundError);
  assert.deepEqual((await setup.service.overview(outsider)).connections, []);

  assert.equal((await setup.service.get(owner, id)).status, "active");
});

test("a workspace's connection is invisible to people without that workspace", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const financeMember = await setup.person("member", undefined, [[finance, "viewer"]]);
  const legalMember = await setup.person("member", undefined, [[legal, "member"]]);

  const id = connectionIdFrom(await setup.connect(owner, "github", { workspaceId: finance })) as ConnectionId;

  assert.equal((await setup.service.get(financeMember, id)).workspace?.name, "Finance");
  await assert.rejects(setup.service.get(legalMember, id), ConnectionNotFoundError);
  assert.deepEqual((await setup.service.overview(legalMember)).connections, []);
});

test("capabilities accept only this provider's names, only what the grant can carry, and only from managers", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const member = await setup.person("member");

  const id = connectionIdFrom(await setup.connect(owner, "github")) as ConnectionId;
  setup.connections.connections.get(id)!.scopes = [];

  await assert.rejects(setup.service.setCapabilities(member, id, ["github.read"]), AccessError);
  await assert.rejects(setup.service.setCapabilities(owner, id, ["drive.read"]), ConnectionValidationError);
  await assert.rejects(setup.service.setCapabilities(owner, id, ["github.write"]), ConnectionValidationError, "no repository scope, no writes");
  await assert.rejects(setup.service.setCapabilities(owner, id, { capabilities: ["github.write"], status: "active" }), ConnectionValidationError);
  await assert.rejects(setup.service.setCapabilities(owner, id, "github.write"), ConnectionValidationError);

  setup.connections.connections.get(id)!.scopes = ["public_repo"];
  const view = await setup.service.setCapabilities(owner, id, ["github.read", "github.write", "github.write"]);
  assert.deepEqual(view.capabilities, ["github.read", "github.write"]);
  assert.equal(setup.events.at(-1)?.type, "connection.updated");
});

test("disconnecting revokes at the provider, erases credentials and keeps the history", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const member = await setup.person("member");
  const id = connectionIdFrom(await setup.connect(owner, "google_drive")) as ConnectionId;

  await assert.rejects(setup.service.disconnect(member, id), AccessError);

  const { connection, providerRevoked } = await setup.service.disconnect(owner, id);

  assert.equal(providerRevoked, true);
  assert.equal(setup.drive.revoked[0]?.refreshToken, SECRETS.refreshToken);
  assert.equal(connection.status, "revoked");
  assert.equal(setup.connections.credentials.has(id), false);
  assert.equal(await setup.connections.readCredentials(owner.organizationId, id), null);

  const event = setup.events.at(-1)!;
  assert.equal(event.type, "connection.disconnected");
  assert.equal(event.payload?.providerRevoked, true);
  assertNoSecrets(setup.events, "the event log");

  await assert.rejects(setup.service.disconnect(owner, id), ConnectionStateError);
  await assert.rejects(setup.service.setCapabilities(owner, id, ["drive.read"]), ConnectionStateError);

  // The record stays, as history.
  assert.equal((await setup.service.overview(owner)).connections.length, 1);
});

test("a provider that cannot confirm the revoke still loses the credentials here", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");
  const id = connectionIdFrom(await setup.connect(owner, "github")) as ConnectionId;

  setup.github.failRevoke = true;
  const { connection, providerRevoked } = await setup.service.disconnect(owner, id);

  assert.equal(providerRevoked, false);
  assert.equal(connection.status, "revoked");
  assert.equal(setup.connections.credentials.has(id), false);
});

test("reconnecting keeps the connection, replaces its credentials and ends the old GitHub token", async () => {
  const setup = await connectionsSetup();
  const owner = await setup.person("owner");

  const first = connectionIdFrom(await setup.connect(owner, "github")) as ConnectionId;
  const firstSealed = setup.connections.credentials.get(first);

  setup.connections.connections.get(first)!.status = "needs_attention";
  const second = connectionIdFrom(await setup.connect(owner, "github")) as ConnectionId;

  assert.equal(second, first);
  assert.notEqual(setup.connections.credentials.get(first), firstSealed);
  assert.equal((await setup.service.get(owner, first)).status, "active");
  assert.equal(setup.github.revoked.length, 1);
  assert.match(setup.github.revoked[0]!.accessToken, /-1$/);
});
