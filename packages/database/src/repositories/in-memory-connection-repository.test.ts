import assert from "node:assert/strict";
import test from "node:test";

import type {
  Connection,
  ConnectionId,
  OrganizationId,
  UserId,
  WorkspaceId,
} from "@unioffice/core";

import { ConnectionConflictError } from "./connection-repository.js";
import { InMemoryConnectionRepository } from "./in-memory-connection-repository.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const owner = "11111111-0000-4000-8000-000000000001" as UserId;
const now = new Date("2026-09-16T12:00:00.000Z");

let counter = 0;

function connection(overrides: Partial<Connection> = {}): Connection {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}` as ConnectionId,
    organizationId: orgA,
    provider: "github",
    status: "active",
    scopes: ["public_repo"],
    capabilities: ["github.read"],
    connectedBy: owner,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("a connection is found only inside its own organization", async () => {
  const repository = new InMemoryConnectionRepository();
  const created = await repository.create(connection(), "sealed");

  assert.equal((await repository.find(orgA, created.id))?.id, created.id);
  assert.equal(await repository.find(orgB, created.id), null);
  assert.equal(await repository.readCredentials(orgB, created.id), null);
  assert.deepEqual(await repository.list(orgB), []);
});

test("one live connection per provider per scope", async () => {
  const repository = new InMemoryConnectionRepository();
  await repository.create(connection(), "sealed");

  await assert.rejects(repository.create(connection(), "sealed"), ConnectionConflictError);

  // A workspace's own connection and another organization's are different scopes.
  await repository.create(connection({ workspaceId: finance }), "sealed");
  await repository.create(connection({ organizationId: orgB }), "sealed");
  await repository.create(connection({ provider: "google_drive", capabilities: ["drive.read"] }), "sealed");

  assert.equal((await repository.findLive(orgA, "github"))?.workspaceId, undefined);
  assert.equal((await repository.findLive(orgA, "github", finance))?.workspaceId, finance);
});

test("revoking erases the credentials and frees the scope", async () => {
  const repository = new InMemoryConnectionRepository();
  const created = await repository.create(connection(), "sealed");

  assert.equal(await repository.revoke(orgB, created.id, owner, now), null);

  const revoked = await repository.revoke(orgA, created.id, owner, now);
  assert.equal(revoked?.status, "revoked");
  assert.equal(await repository.readCredentials(orgA, created.id), null);
  assert.equal(await repository.replaceCredentials(orgA, created.id, "again", now), false);
  assert.equal(await repository.revoke(orgA, created.id, owner, now), null);
  assert.equal(await repository.findLive(orgA, "github"), null);

  // Nothing but revoke can revive or revoke a row.
  const updated = await repository.update({ ...revoked!, status: "active" });
  assert.equal(updated.status, "revoked");

  await repository.create(connection(), "sealed");
});

test("an OAuth state is consumed at most once", async () => {
  const repository = new InMemoryConnectionRepository();
  const hash = "a".repeat(64);

  await repository.saveOAuthState(hash, {
    organizationId: orgA,
    provider: "github",
    userId: owner,
    codeVerifier: "sealed",
    requestedScopes: ["public_repo"],
    expiresAt: new Date(now.getTime() + 600_000),
    createdAt: now,
  });

  assert.equal((await repository.consumeOAuthState(hash))?.organizationId, orgA);
  assert.equal(await repository.consumeOAuthState(hash), null);
});

test("expired OAuth states are cleared", async () => {
  const repository = new InMemoryConnectionRepository();
  const base = {
    organizationId: orgA,
    provider: "github" as const,
    userId: owner,
    codeVerifier: "sealed",
    requestedScopes: [],
    createdAt: now,
  };

  await repository.saveOAuthState("b".repeat(64), { ...base, expiresAt: new Date(now.getTime() - 1) });
  await repository.saveOAuthState("c".repeat(64), { ...base, expiresAt: new Date(now.getTime() + 600_000) });
  await repository.deleteExpiredOAuthStates(now);

  assert.equal(await repository.consumeOAuthState("b".repeat(64)), null);
  assert.notEqual(await repository.consumeOAuthState("c".repeat(64)), null);
});
