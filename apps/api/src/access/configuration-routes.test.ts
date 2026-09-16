import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, OrganizationRole, UserId, WorkspaceAccessLevel } from "@unioffice/core";

import { buildApiServer, type ApiServices } from "../server.js";

import { StreamTickets } from "./stream-tickets.js";
import { signedIn, TEST_TOKEN } from "./testing.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f";
const legal = "a0000000-0000-4000-8000-00000000000a";
const policyId = "b0000000-0000-4000-8000-000000000001";
const agentId = "e0000000-0000-4000-8000-000000000001";
const userId = "22222222-0000-4000-8000-000000000002" as UserId;

function server(role: OrganizationRole, workspaces: Record<string, WorkspaceAccessLevel> = {}) {
  const calls: Array<{ call: string; input?: unknown }> = [];
  const record = (call: string) => async (input?: unknown) => {
    calls.push({ call, input });
    return { id: "x" };
  };

  const services = {
    ...signedIn({ organizationId: orgA, role, userId, workspaces }),
    streamTickets: new StreamTickets(),
    governanceService: { createPolicy: record("createPolicy"), updatePolicy: record("updatePolicy") },
    workspaceService: {
      createWorkspace: record("createWorkspace"),
      updateWorkspace: record("updateWorkspace"),
      getWorkspaceDetail: async (_org: string, id: string) => ({ workspace: { id }, agents: [] }),
    },
    agentDirectoryService: { createAgent: record("createAgent"), updateAgent: record("updateAgent") },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  const app = buildApiServer(services);
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${TEST_TOKEN}` }, payload });

  return { app, post, calls };
}

const policy = { name: "Payments need a person", subject: "tool", effect: "require_approval", risk: "high", scope: {} };
const agent = { name: "Ledger", description: "Keeps the books.", type: "specialist", capabilities: ["calculation"], toolIds: ["calculator"] };

const changes = (post: ReturnType<typeof server>["post"]) => [
  () => post("/policies", policy),
  () => post(`/policies/${policyId}`, { status: "paused" }),
  () => post("/workspaces", { name: "Treasury" }),
  () => post(`/workspaces/${finance}`, { name: "Finance and Tax" }),
  () => post("/agents", agent),
  () => post(`/agents/${agentId}`, { toolIds: ["calculator", "datetime"] }),
];

test("members and viewers cannot change policies, workspaces, agents or tool grants", async () => {
  for (const role of ["member", "viewer"] as const) {
    const { post, calls } = server(role, { [finance]: "member" });

    for (const [index, change] of changes(post).entries()) {
      const response = await change();
      assert.equal(response.statusCode, 403, `${role}: change ${index}`);
    }

    assert.deepEqual(calls, [], role);
  }
});

test("admins and owners configure the organization", async () => {
  for (const role of ["admin", "owner"] as const) {
    const { post, calls } = server(role);

    for (const [index, change] of changes(post).entries()) {
      const response = await change();
      assert.ok(response.statusCode === 200 || response.statusCode === 201, `${role}: change ${index} gave ${response.statusCode}`);
    }

    assert.equal(calls.length, 6, role);
  }
});

test("a policy's author is the signed-in caller, whatever the body claims", async () => {
  const { post, calls } = server("admin");

  await post("/policies", { ...policy, createdBy: "user:someone-else" });

  assert.equal((calls[0]!.input as { createdBy: string }).createdBy, `user:${userId}`);
});

test("a workspace the caller was not given reads as not found", async () => {
  const { app } = server("member", { [finance]: "viewer" });
  const headers = { authorization: `Bearer ${TEST_TOKEN}` };

  assert.equal((await app.inject({ method: "GET", url: `/workspaces/${finance}`, headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/workspaces/${legal}`, headers })).statusCode, 404);
});
