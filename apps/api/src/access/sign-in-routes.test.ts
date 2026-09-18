import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, UserId, Work } from "@unioffice/core";

import type { CreateWorkInput } from "../application.js";
import { buildTestServer, TEST_TOKEN, type TestServices } from "./testing.js";

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;

function services(overrides: Partial<TestServices> = {}): TestServices {
  const created: CreateWorkInput[] = [];

  return {
    applicationService: {
      async createWork(input: CreateWorkInput) {
        created.push(input);
        return { id: "work-1", ...input } as unknown as Work;
      },
      created,
    } as unknown as TestServices["applicationService"],
    workService: {} as TestServices["workService"],
    workExecutionService: {} as TestServices["workExecutionService"],
    workApprovalService: {} as TestServices["workApprovalService"],
    workQueryService: {
      async listWork() { return []; },
    } as unknown as TestServices["workQueryService"],
    companyBrainService: {} as TestServices["companyBrainService"],
    companyOverviewService: {} as TestServices["companyOverviewService"],
    workspaceService: {} as TestServices["workspaceService"],
    agentDirectoryService: {} as TestServices["agentDirectoryService"],
    missionTemplateService: {} as TestServices["missionTemplateService"],
    workRecoveryService: {} as TestServices["workRecoveryService"],
    workCancellationService: {} as TestServices["workCancellationService"],
    executionQueueService: {} as TestServices["executionQueueService"],
    missionControlService: {} as TestServices["missionControlService"],
    governanceService: {} as TestServices["governanceService"],
    governanceOverviewService: {} as TestServices["governanceOverviewService"],
    executionRoomService: {} as TestServices["executionRoomService"],
    executionStream: {} as TestServices["executionStream"],
    toolRegistry: { list: () => [] } as unknown as TestServices["toolRegistry"],
    healthCheck: async () => ({ ok: true }),
    corsOrigins: ["http://localhost:5173"],
    developmentOrganizationId: orgA,
    ...overrides,
  };
}

test("a request without a session is refused before any handler runs", async () => {
  const app = buildTestServer(services());

  for (const [method, url] of [["GET", `/work?organizationId=${orgA}`], ["POST", "/work"], ["GET", "/stream"], ["GET", "/tools"]] as const) {
    const response = await app.inject({ method, url, headers: { authorization: "" }, payload: method === "POST" ? { objective: "x" } : undefined });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
    assert.equal(response.json().error.code, "UNAUTHENTICATED");
  }
});

test("a forged, malformed or non-bearer token is refused", async () => {
  const app = buildTestServer(services());

  for (const authorization of ["Bearer not-the-session", "Basic dGVzdDp0ZXN0", `Bearer ${TEST_TOKEN} extra`, TEST_TOKEN]) {
    const response = await app.inject({ method: "GET", url: "/tools", headers: { authorization } });
    assert.equal(response.statusCode, 401, authorization);
  }
});

test("the health check stays reachable without a session", async () => {
  const app = buildTestServer(services());
  const response = await app.inject({ method: "GET", url: "/health", headers: { authorization: "" } });

  assert.notEqual(response.statusCode, 401);
});

test("liveness says the process is up without asking anything else", async () => {
  let asked = 0;
  const app = buildTestServer(services({ healthCheck: async () => { asked += 1; return {}; } }));

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ok");
  assert.equal(asked, 0, "liveness must not depend on anything that can be down");
  assert.equal(typeof response.json().uptimeSeconds, "number");
});

test("readiness reports the dependencies, and stays reachable without a session", async () => {
  const app = buildTestServer(services({
    healthCheck: async () => ({ supabase: "ready", ollama: "unreachable", executionQueue: "ready" }),
  }));

  const response = await app.inject({ method: "GET", url: "/readiness", headers: { authorization: "" } });

  assert.equal(response.statusCode, 200, "a model that is briefly down does not take the API out of rotation");
  assert.equal(response.json().status, "ready");
  assert.equal(response.json().checks.ollama, "unreachable");
});

test("readiness refuses traffic when something it needs is down", async () => {
  const app = buildTestServer(services({
    healthCheck: async () => { throw new Error("Supabase health check failed: connection refused"); },
  }));

  const response = await app.inject({ method: "GET", url: "/readiness" });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, "not_ready");
  assert.match(response.json().reason, /Supabase health check failed/);
});

test("the browser may send the Authorization header", async () => {
  const app = buildTestServer(services());
  const response = await app.inject({ method: "OPTIONS", url: "/work", headers: { origin: "http://localhost:5173", authorization: "" } });

  assert.equal(response.statusCode, 204);
  assert.match(String(response.headers["access-control-allow-headers"]), /authorization/);
});

test("naming an organization the caller is not a member of reads as not found", async () => {
  const app = buildTestServer(services());

  const inQuery = await app.inject({ method: "GET", url: `/work?organizationId=${orgB}` });
  const inBody = await app.inject({ method: "POST", url: "/work", payload: { organizationId: orgB, objective: "Do their work" } });

  assert.equal(inQuery.statusCode, 404);
  assert.equal(inQuery.json().error.message, "Organization not found.");
  assert.equal(inBody.statusCode, 404);
});

test("a query and a body naming different organizations are refused, not reconciled", async () => {
  const app = buildTestServer(services());
  const response = await app.inject({
    method: "POST",
    url: `/work?organizationId=${orgA}`,
    payload: { organizationId: orgB, objective: "Which one?" },
  });

  assert.equal(response.statusCode, 404);
});

test("work is filed under the caller's organization and identity, whatever the body says", async () => {
  const signedInUser = "22222222-0000-4000-8000-000000000002" as UserId;
  const base = services();
  const app = buildTestServer({
    ...base,
    ...(await import("./testing.js")).signedIn({ organizationId: orgA, userId: signedInUser }),
  });

  const response = await app.inject({
    method: "POST",
    url: "/work",
    payload: { objective: "Plan the launch", requesterId: "99999999-9999-4999-8999-999999999999", organizationId: orgA },
  });

  assert.equal(response.statusCode, 201);
  const created = (base.applicationService as unknown as { created: CreateWorkInput[] }).created;
  assert.equal(created[0]?.organizationId, orgA);
  assert.equal(created[0]?.requesterId, signedInUser);
});
