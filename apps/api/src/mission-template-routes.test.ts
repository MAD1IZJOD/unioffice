import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Event,
  OrganizationId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  EventRepository,
  PolicyRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import { WorkApplicationService } from "./application.js";
import { EventRecorder } from "./event-recorder.js";
import { MissionTemplateService } from "./mission-template-service.js";
import { buildApiServer, type ApiServices } from "./server.js";

/**
 * The template routes over the real template service and the real application
 * service, with in-memory stores. What these prove is the edge: the
 * organization binding, input shape checks, the error mapping, and that a
 * request cannot choose its own requester or smuggle in state.
 */

const org = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
const otherOrg = "bbbbbbbb-0000-0000-0000-000000000002";
const developmentRequester = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";
const finance = "f0000000-0000-0000-0000-00000000000f" as WorkspaceId;
const foreign = "b0000000-0000-0000-0000-00000000000b" as WorkspaceId;
const now = new Date();

function harness(options: { failList?: boolean } = {}) {
  const works = new Map<WorkId, Work>();
  const events: Event[] = [];

  const agents: Agent[] = [
    { id: "tyrion" as AgentId, organizationId: org, name: "Tyrion", description: "", type: "orchestrator", status: "active", capabilities: ["planning"], toolIds: [], createdAt: now, updatedAt: now, metadata: {} },
    { id: "harvey" as AgentId, organizationId: org, name: "Harvey", description: "", type: "specialist", status: "active", capabilities: ["financial_analysis", "calculation"], toolIds: ["calculator"], createdAt: now, updatedAt: now, metadata: {} },
  ];
  const workspaces = new Map<string, Workspace>([
    [finance, { id: finance, organizationId: org, name: "Finance", slug: "finance", status: "active", createdAt: now, updatedAt: now, metadata: {} }],
    [foreign, { id: foreign, organizationId: otherOrg as OrganizationId, name: "Theirs", slug: "theirs", status: "active", createdAt: now, updatedAt: now, metadata: {} }],
  ]);

  const workRepository = {
    async create(work: Work) { works.set(work.id, work); return work; },
  } as unknown as WorkRepository;
  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };
  const agentRepository = {
    async findByOrganization() {
      if (options.failList) throw new Error("connection to db.internal:5432 refused (password=hunter2)");
      return agents;
    },
  } as unknown as AgentRepository;
  const workspaceRepository = {
    async findById(id: WorkspaceId) { return workspaces.get(id) ?? null; },
  } as unknown as WorkspaceRepository;
  const policyRepository = { async findEnforced() { return []; } } as unknown as PolicyRepository;

  const missionTemplateService = new MissionTemplateService(
    new WorkApplicationService(workRepository, new EventRecorder(eventRepository)),
    agentRepository,
    workspaceRepository,
    policyRepository,
  );

  const app = buildApiServer({
    missionTemplateService,
    developmentOrganizationId: org,
    corsOrigins: [],
    healthCheck: async () => ({}),
  } as unknown as ApiServices);

  return { app, works, events };
}

const validBody = {
  organizationId: org,
  objective: "Review Q3 operating costs against revenue and runway.",
  desiredOutcome: "Monthly burn and months of runway.",
  context: "Salaries 48,200; cloud 9,350; revenue 61,000; cash 900,000.",
  priority: "high",
};

test("lists the templates with their real likely team", async () => {
  const { app } = harness();

  const response = await app.inject({ method: "GET", url: `/mission-templates?organizationId=${org}` });

  assert.equal(response.statusCode, 200);
  const { templates } = response.json();
  assert.equal(templates.length, 6);

  const review = templates.find((entry: { template: { id: string } }) => entry.template.id === "prepare-a-financial-review");
  assert.deepEqual(review.likelyTeam.map((member: { name: string }) => member.name), ["Harvey"]);
  assert.equal(review.planner.name, "Tyrion");
});

test("another organization's id is refused on every template route", async () => {
  const { app, works } = harness();

  const list = await app.inject({ method: "GET", url: `/mission-templates?organizationId=${otherOrg}` });
  const detail = await app.inject({ method: "GET", url: `/mission-templates/launch-a-product?organizationId=${otherOrg}` });
  const start = await app.inject({
    method: "POST",
    url: "/mission-templates/prepare-a-financial-review/missions",
    payload: { ...validBody, organizationId: otherOrg },
  });

  assert.deepEqual([list.statusCode, detail.statusCode, start.statusCode], [404, 404, 404]);
  assert.equal(works.size, 0);
});

test("an unknown or oddly shaped template id is simply not found", async () => {
  const { app } = harness();

  for (const id of ["not-a-template", "LAUNCH-A-PRODUCT", "launch_a_product", "x".repeat(80), "%2e%2e%2fsecrets"]) {
    const response = await app.inject({ method: "GET", url: `/mission-templates/${id}?organizationId=${org}` });
    assert.equal(response.statusCode, 404, id);
    assert.equal(response.json().error.code, "NOT_FOUND");
  }
});

test("starting a template returns created work bound to the server's requester", async () => {
  const { app, works } = harness();

  const response = await app.inject({
    method: "POST",
    url: "/mission-templates/prepare-a-financial-review/missions",
    payload: { ...validBody, workspaceId: finance, requesterId: "11111111-1111-1111-1111-111111111111" },
  });

  assert.equal(response.statusCode, 201);
  const { work } = response.json();

  assert.equal(work.status, "queued");
  assert.equal(work.objective, validBody.objective);
  assert.equal(work.priority, "high");
  assert.equal(work.workspaceId, finance);
  assert.equal(work.requesterId, developmentRequester, "the body cannot name its own requester");
  assert.equal(work.metadata.template.id, "prepare-a-financial-review");
  assert.equal(works.size, 1);
});

test("state a caller has no business setting is ignored", async () => {
  const { app } = harness();

  const response = await app.inject({
    method: "POST",
    url: "/mission-templates/prepare-a-financial-review/missions",
    payload: {
      ...validBody,
      status: "completed",
      metadata: { approval: { status: "approved" }, plan: { taskCount: 9 } },
      agentIds: ["harvey"],
      approvalId: "11111111-1111-1111-1111-111111111111",
      template: { id: "evil" },
    },
  });

  assert.equal(response.statusCode, 201);
  const { work } = response.json();
  assert.equal(work.status, "queued");
  assert.deepEqual(Object.keys(work.metadata).sort(), ["briefing", "template"]);
});

test("malformed input is a clean 400 with a message naming the field", async () => {
  const { app, works } = harness();
  const url = "/mission-templates/prepare-a-financial-review/missions";

  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ ...validBody, objective: undefined }, /objective is required/],
    [{ ...validBody, desiredOutcome: "" }, /desiredOutcome is required/],
    [{ ...validBody, objective: 42 }, /objective must be text/],
    [{ ...validBody, context: ["a", "b"] }, /context must be text/],
    [{ ...validBody, priority: "urgent!!" }, /priority is invalid/],
    [{ ...validBody, workspaceId: "not-a-uuid" }, /workspaceId must be a valid identifier/],
    [{ ...validBody, objective: "x".repeat(1_001) }, /objective must be 1000 characters or fewer/],
  ];

  for (const [payload, message] of cases) {
    const response = await app.inject({ method: "POST", url, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload).slice(0, 80));
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
    assert.match(response.json().error.message, message);
  }

  const notJson = await app.inject({ method: "POST", url, payload: "objective=hi", headers: { "content-type": "text/plain" } });
  assert.ok([400, 415].includes(notJson.statusCode));
  assert.equal(works.size, 0);
});

test("a workspace from another organization is not found, not forbidden", async () => {
  const { app, works } = harness();

  const response = await app.inject({
    method: "POST",
    url: "/mission-templates/prepare-a-financial-review/missions",
    payload: { ...validBody, workspaceId: foreign },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(works.size, 0);
});

test("an internal failure never reaches the client", async () => {
  const { app } = harness({ failList: true });

  const response = await app.inject({ method: "GET", url: `/mission-templates?organizationId=${org}` });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.message, "An internal error occurred.");
  assert.doesNotMatch(response.body, /hunter2|db\.internal/);
});
