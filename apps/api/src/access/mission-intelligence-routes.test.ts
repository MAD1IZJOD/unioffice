import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  OrganizationId,
  OrganizationRole,
  Task,
  TaskId,
  UserId,
  Work,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { buildApiServer, type ApiServices } from "../server.js";
import { MissionIntelligenceService } from "../mission-intelligence-service.js";
import { MissionLauncher } from "../mission-launcher.js";

import { signedIn, TEST_TOKEN } from "./testing.js";
import { StreamTickets } from "./stream-tickets.js";

/**
 * Reading a mission before running it, over HTTP.
 *
 * Two things matter here and they are both about the boundary rather than
 * about the reading. A mission in an organization or a workspace the caller
 * cannot reach has to read exactly like one that does not exist. And
 * preparing a mission - which writes a plan - has to be refused for anyone
 * who could not operate it, whatever the read says.
 */

const orgA = "aaaaaaaa-0000-4000-8000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
const finance = "f0000000-0000-4000-8000-00000000000f" as WorkspaceId;
const missionId = "cccccccc-0000-4000-8000-000000000001" as WorkId;
const theirMission = "dddddddd-0000-4000-8000-000000000002" as WorkId;
const epoch = new Date("2026-09-21T09:00:00.000Z");
const bearer = { authorization: `Bearer ${TEST_TOKEN}` };

const harvey: Agent = {
  id: "agent-harvey" as AgentId,
  organizationId: orgA,
  name: "Harvey",
  description: "Runs the numbers.",
  type: "specialist",
  status: "active",
  capabilities: ["financial_analysis"],
  toolIds: ["calculator"],
  skills: ["financial-analysis"],
  createdAt: epoch,
  updatedAt: epoch,
  metadata: { systemInstructions: "PROMPT-THAT-MUST-STAY-ON-THE-SERVER" },
};

function mission(overrides: Partial<Work> = {}): Work {
  return {
    id: missionId,
    organizationId: orgA,
    requesterId: "11111111-0000-4000-8000-000000000001" as UserId,
    objective: "Decide whether the laptop upgrade is worth it.",
    status: "queued",
    priority: "normal",
    createdAt: epoch,
    updatedAt: epoch,
    metadata: { plan: { taskCount: 1 } },
    ...overrides,
  };
}

const step: Task = {
  id: "task-1" as TaskId,
  workId: missionId,
  title: "Work out the total cost",
  description: "Add it up.",
  status: "pending",
  assignedAgentId: harvey.id,
  dependsOn: [],
  createdAt: epoch,
  updatedAt: epoch,
  metadata: {
    routing: {
      requiredTools: ["calculator"],
      requiredCapabilities: ["financial_analysis"],
      skill: { slug: "financial-analysis", name: "Financial analysis", version: 1, scope: "system" },
    },
    delegation: {
      selectionReason:
        "Selected by deterministic rank: exact workspace compatibility, 1 required capability matches, compatible agent type, and availability score 100. It satisfies every required capability: financial_analysis.",
    },
  },
};

function server(
  role: OrganizationRole,
  options: { work?: Work; tasks?: Task[]; launcher?: ApiServices["missionLauncher"]; planWork?: () => Promise<unknown> } = {},
) {
  const work = options.work ?? mission();
  const planned: WorkId[] = [];
  const queued: WorkId[] = [];

  const launcher = options.launcher ?? new MissionLauncher({
    async planWork(workId) {
      planned.push(workId);
      return { work: { status: "queued" } };
    },
    async enqueueWork(workId) {
      queued.push(workId);
      return null;
    },
  });

  const services = {
    ...signedIn({ organizationId: orgA, role }),
    streamTickets: new StreamTickets(),
    workQueryService: {
      async assertWorkInOrganization(workId: WorkId, organizationId: OrganizationId) {
        if (workId === theirMission || organizationId !== orgA) {
          throw Object.assign(new Error(`Work not found: ${workId}`), { statusCode: 404 });
        }
        return work;
      },
    },
    workService: {
      async beginPlanning() { return true; },
    },
    missionLauncher: launcher,
    missionIntelligenceService: new MissionIntelligenceService({
      tasks: { async findByWork() { return options.tasks ?? [step]; } },
      agents: { async findByOrganization() { return [harvey]; } },
      workspaces: { async findByOrganization() { return []; } },
      policies: { async findEnforced() { return []; } },
      tools: createDefaultToolRegistry(),
      now: () => epoch,
    }),
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices;

  return { app: buildApiServer(services), planned, queued };
}

async function read(role: OrganizationRole, options: Parameters<typeof server>[1] = {}) {
  const { app } = server(role, options);
  const response = await app.inject({ method: "GET", url: `/work/${missionId}/intelligence`, headers: bearer });
  return { status: response.statusCode, body: response.json() };
}

test("the intelligence read answers with the brief, the preflight and the plan", async () => {
  const { status, body } = await read("owner");

  assert.equal(status, 200);
  assert.equal(body.stage, "planned");
  assert.equal(body.brief.objective, "Decide whether the laptop upgrade is worth it.");
  assert.equal(body.preflight.state, "ready");
  assert.equal(body.preflight.canStart, true);
  assert.deepEqual(body.plan.steps.map((planStep: { title: string }) => planStep.title), ["Work out the total cost"]);
});

test("a viewer reads the mission but is not told they can start it", async () => {
  const { body } = await read("viewer");

  assert.equal(body.preflight.canStart, false);
  assert.match(body.preflight.startNote, /not start it/);
});

test("the read never carries an agent's instructions, a task id or a resolver score", async () => {
  const { body } = await read("owner");
  const serialized = JSON.stringify({ brief: body.brief, preflight: body.preflight });

  assert.equal(serialized.includes("PROMPT-THAT-MUST-STAY-ON-THE-SERVER"), false);
  assert.equal(serialized.includes("task-1"), false);
  assert.equal(serialized.includes("deterministic"), false);

  // The machinery is still available, but only under the technical detail.
  assert.match(body.plan.steps[0].technical.selectionReason, /deterministic rank/);
  assert.equal(body.plan.steps[0].why, "Harvey can do what this step calls for and is cleared to use Calculator.");
});

test("a mission in another organization reads as not found rather than as refused", async () => {
  const { app } = server("owner");
  const response = await app.inject({ method: "GET", url: `/work/${theirMission}/intelligence`, headers: bearer });

  assert.equal(response.statusCode, 404);
});

test("signed out, the read is refused rather than answered", async () => {
  const { app } = server("owner");
  const response = await app.inject({ method: "GET", url: `/work/${missionId}/intelligence` });

  assert.equal(response.statusCode, 401);
});

test("a server built without mission intelligence says so instead of failing oddly", async () => {
  const { app } = server("owner", {});
  const bare = buildApiServer({
    ...signedIn({ organizationId: orgA, role: "owner" }),
    streamTickets: new StreamTickets(),
    workQueryService: { async assertWorkInOrganization() { return mission(); } },
    healthCheck: async () => ({}),
    corsOrigins: [],
  } as unknown as ApiServices);

  const response = await bare.inject({ method: "GET", url: `/work/${missionId}/intelligence`, headers: bearer });
  assert.equal(response.statusCode, 503);
  assert.equal((await app.inject({ method: "GET", url: `/work/${missionId}/intelligence`, headers: bearer })).statusCode, 200);
});

/* --------------------------------------------------------------------------
   Preparing
   -------------------------------------------------------------------------- */

test("preparing a mission writes the plan and deliberately does not run it", async () => {
  const { app, planned, queued } = server("owner", { work: mission({ metadata: {} }) });

  const response = await app.inject({ method: "POST", url: `/work/${missionId}/prepare`, headers: bearer });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { prepared: true, workId: missionId, alreadyPlanned: false });

  // The launcher runs off the request, so let its work settle before looking.
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(planned, [missionId]);
  assert.deepEqual(queued, [], "preparing must never put a mission on the queue");
});

test("preparing a mission that already has a plan answers without planning it again", async () => {
  const { app, planned } = server("owner");

  const response = await app.inject({ method: "POST", url: `/work/${missionId}/prepare`, headers: bearer });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().alreadyPlanned, true);
  assert.deepEqual(planned, []);
});

test("a viewer cannot prepare a mission, however the read reports it", async () => {
  const { app, planned } = server("viewer", { work: mission({ metadata: {} }) });

  const response = await app.inject({ method: "POST", url: `/work/${missionId}/prepare`, headers: bearer });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(planned, []);
});

test("a mission that is already running cannot be prepared", async () => {
  const { app } = server("owner", { work: mission({ status: "executing", metadata: {} }) });

  const response = await app.inject({ method: "POST", url: `/work/${missionId}/prepare`, headers: bearer });

  assert.equal(response.statusCode, 409);
});

test("preparing another organization's mission reads as not found", async () => {
  const { app } = server("owner");
  const response = await app.inject({ method: "POST", url: `/work/${theirMission}/prepare`, headers: bearer });

  assert.equal(response.statusCode, 404);
});
