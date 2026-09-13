import assert from "node:assert/strict";
import test from "node:test";

import type {
  Event,
  Memory,
  MemoryId,
  OrganizationId,
} from "@unioffice/core";

import type {
  ArtifactRepository,
  EventRepository,
  PolicyRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
  AgentRepository,
} from "@unioffice/database";

import { InMemoryKnowledgeRepository } from "@unioffice/database";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { CompanyBrainService } from "./company-brain-service.js";
import { EventRecorder } from "./event-recorder.js";
import { GovernanceService } from "./governance-service.js";
import { KnowledgeCaptureService } from "./knowledge-capture-service.js";
import { KnowledgeGovernance } from "./knowledge-governance.js";
import { KnowledgeRecallService } from "./knowledge-recall-service.js";
import { buildApiServer, type ApiServices } from "./server.js";

/**
 * Merging and replacing knowledge at the edge, over the real Brain service and
 * an in-memory store: the organization binding, id validation, who is recorded
 * as having decided, the error mapping, and that a refused request changes
 * nothing.
 */

const org = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
const otherOrg = "bbbbbbbb-0000-0000-0000-000000000002" as OrganizationId;
const developmentRequester = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";
const now = new Date();

function harness() {
  const store = new InMemoryKnowledgeRepository();
  const events: Event[] = [];

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };
  const nothing = { async findById() { return null; } };
  const policyRepository = {
    async findEnforced() { return []; },
    async findByOrganization() { return []; },
  } as unknown as PolicyRepository;

  const recorder = new EventRecorder(eventRepository);
  const governance = new KnowledgeGovernance(
    policyRepository,
    new GovernanceService(policyRepository, createDefaultToolRegistry(), recorder),
  );
  const workRepository = nothing as unknown as WorkRepository;
  const taskRepository = nothing as unknown as TaskRepository;
  const artifactRepository = nothing as unknown as ArtifactRepository;

  const companyBrainService = new CompanyBrainService(
    store,
    store,
    new KnowledgeRecallService(store, store, governance, recorder, workRepository, taskRepository, artifactRepository),
    new KnowledgeCaptureService(store, store, governance, recorder),
    recorder,
    workRepository,
    taskRepository,
    artifactRepository,
    nothing as unknown as WorkspaceRepository,
    nothing as unknown as AgentRepository,
  );

  const app = buildApiServer({
    companyBrainService,
    developmentOrganizationId: org,
    corsOrigins: [],
    healthCheck: async () => ({}),
  } as unknown as ApiServices);

  async function entry(overrides: Partial<Memory> = {}): Promise<Memory> {
    return store.create({
      id: crypto.randomUUID() as MemoryId,
      organizationId: org,
      scope: "company",
      type: "fact",
      status: "proposed",
      title: "Starter churn peaks in month two",
      content: "Starter plan churn is highest in the second month.",
      sourceType: "task",
      importance: 0.6,
      createdAt: now,
      updatedAt: now,
      metadata: {},
      ...overrides,
    });
  }

  return { app, store, events, entry };
}

test("merging records the server's requester as the reviewer, whatever the body claims", async () => {
  const { app, store, entry } = harness();
  const original = await entry({ status: "active", title: "Starter churn is highest in month two" });
  const restatement = await entry();

  const response = await app.inject({
    method: "POST",
    url: `/knowledge/${restatement.id}/merge`,
    payload: { organizationId: org, intoId: original.id, by: "user:someone-else", reviewedBy: "user:someone-else" },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.knowledge.id, original.id);
  assert.equal(body.knowledge.reviewedBy, `user:${developmentRequester}`);
  assert.equal(body.merged.status, "archived");
  assert.equal((await store.findById(restatement.id))!.metadata.mergedIntoId, original.id);
});

test("replacing keeps the older entry as history and records the note", async () => {
  const { app, store, entry } = harness();
  const older = await entry({ status: "active", type: "decision", title: "Launches need manual finance sign-off", content: "A person in finance signs off every launch." });
  const newer = await entry({ status: "active", type: "decision", title: "Launch sign-off is automated", content: "Launch budgets inside the envelope are signed off automatically." });

  const response = await app.inject({
    method: "POST",
    url: `/knowledge/${newer.id}/supersede`,
    payload: { organizationId: org, replacesId: older.id, note: "Automated in the September finance review." },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().knowledge.supersedesId, older.id);

  const archived = (await store.findById(older.id))!;
  assert.equal(archived.status, "archived");
  assert.equal(archived.metadata.archivedReason, "Automated in the September finance review.");
});

test("a request naming another organization changes nothing", async () => {
  const { app, store, entry } = harness();
  const original = await entry({ status: "active" });
  const restatement = await entry({ title: "Starter customers churn in month two" });

  const response = await app.inject({
    method: "POST",
    url: `/knowledge/${restatement.id}/merge`,
    payload: { organizationId: otherOrg, intoId: original.id },
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.message, "Organization not found.");
  assert.equal((await store.findById(restatement.id))!.status, "proposed");
});

test("knowledge belonging to another organization is not found, on either side", async () => {
  const { app, store, entry } = harness();
  const ours = await entry({ status: "active" });
  const theirs = await entry({ organizationId: otherOrg, title: "Their churn note" });

  const intoTheirs = await app.inject({
    method: "POST",
    url: `/knowledge/${ours.id}/supersede`,
    payload: { organizationId: org, replacesId: theirs.id },
  });
  const fromTheirs = await app.inject({
    method: "POST",
    url: `/knowledge/${theirs.id}/merge`,
    payload: { organizationId: org, intoId: ours.id },
  });

  for (const response of [intoTheirs, fromTheirs]) {
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.message, "Knowledge not found.");
  }

  assert.equal((await store.findById(theirs.id))!.status, "proposed");
  assert.equal((await store.findById(ours.id))!.supersedesId, undefined);
});

test("malformed ids, self-merges and archived knowledge are refused with a plain reason", async () => {
  const { app, entry } = harness();
  const current = await entry({ status: "active" });
  const archived = await entry({ status: "archived", title: "An archived churn note" });

  const malformed = await app.inject({
    method: "POST",
    url: `/knowledge/${current.id}/merge`,
    payload: { organizationId: org, intoId: "../../memories" },
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().error.message, "intoId must be a valid identifier.");

  const missing = await app.inject({
    method: "POST",
    url: `/knowledge/${current.id}/supersede`,
    payload: { organizationId: org },
  });
  assert.equal(missing.statusCode, 400);

  const itself = await app.inject({
    method: "POST",
    url: `/knowledge/${current.id}/merge`,
    payload: { organizationId: org, intoId: current.id },
  });
  assert.equal(itself.statusCode, 400);

  const fromArchive = await app.inject({
    method: "POST",
    url: `/knowledge/${archived.id}/merge`,
    payload: { organizationId: org, intoId: current.id },
  });
  assert.equal(fromArchive.statusCode, 409);
});

test("a store failure is reported generically, never with its details", async () => {
  const { app, store, entry } = harness();
  const original = await entry({ status: "active" });
  const restatement = await entry({ title: "Starter customers churn in month two" });

  store.update = async () => {
    throw new Error("update memories failed: connection to db.internal refused (password=hunter2)");
  };

  const response = await app.inject({
    method: "POST",
    url: `/knowledge/${restatement.id}/merge`,
    payload: { organizationId: org, intoId: original.id },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error.message, "An internal error occurred.");
  assert.doesNotMatch(response.body, /hunter2|db\.internal/);
});
