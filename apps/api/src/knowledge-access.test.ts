import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentRepository,
  ArtifactRepository,
  EventRepository,
  PolicyRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import type {
  Artifact,
  ArtifactId,
  Event,
  OrganizationId,
  Work,
  WorkId,
  Workspace,
  WorkspaceId,
} from "@unioffice/core";

import { InMemoryKnowledgeRepository } from "@unioffice/database";
import { KnowledgeExtractor } from "@unioffice/memory";
import { createDefaultToolRegistry } from "@unioffice/tools";

import { CompanyBrainService, KnowledgeNotFoundError } from "./company-brain-service.js";
import { EventRecorder } from "./event-recorder.js";
import { GovernanceService } from "./governance-service.js";
import { KnowledgeCaptureService } from "./knowledge-capture-service.js";
import { KnowledgeGovernance } from "./knowledge-governance.js";
import { KnowledgeRecallService } from "./knowledge-recall-service.js";

/**
 * The Brain's side of workspace access, over the production services and
 * in-memory stores: what a person who reaches only some workspaces is shown,
 * and what someone who may only propose knowledge leaves behind.
 */

const org = "aaaaaaaa-0000-0000-0000-000000000001" as OrganizationId;
const finance = "f0000000-0000-0000-0000-00000000000f" as WorkspaceId;
const now = new Date();
const companyOnly = (workspaceId: WorkspaceId | undefined) => !workspaceId;

function setup() {
  const store = new InMemoryKnowledgeRepository();
  const events: Event[] = [];
  const works = new Map<string, Work>();
  const artifacts = new Map<string, Artifact>();
  const workspaces = new Map<string, Workspace>([
    [finance, { id: finance, organizationId: org, name: "Finance", slug: "finance", status: "active", createdAt: now, updatedAt: now, metadata: {} }],
  ]);

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };
  const workRepository = { async findById(id: WorkId) { return works.get(id) ?? null; } } as unknown as WorkRepository;
  const taskRepository = { async findById() { return null; } } as unknown as TaskRepository;
  const artifactRepository = { async findById(id: ArtifactId) { return artifacts.get(id) ?? null; } } as unknown as ArtifactRepository;
  const workspaceRepository = { async findById(id: WorkspaceId) { return workspaces.get(id) ?? null; } } as unknown as WorkspaceRepository;
  const agentRepository = { async findById() { return null; } } as unknown as AgentRepository;
  const policyRepository: PolicyRepository = {
    async create(policy) { return policy; },
    async findById() { return null; },
    async findByOrganization() { return []; },
    async findEnforced() { return []; },
    async update(policy) { return policy; },
  };

  const recorder = new EventRecorder(eventRepository);
  const governance = new KnowledgeGovernance(policyRepository, new GovernanceService(policyRepository, createDefaultToolRegistry(), recorder));
  const recall = new KnowledgeRecallService(store, store, governance, recorder, workRepository, taskRepository, artifactRepository);
  const capture = new KnowledgeCaptureService(store, store, governance, recorder, new KnowledgeExtractor({
    async generate() { return { content: '{"knowledge": []}', model: "test" }; },
  }, "test"));
  const brain = new CompanyBrainService(
    store, store, recall, capture, recorder,
    workRepository, taskRepository, artifactRepository, workspaceRepository, agentRepository,
  );

  const write = (title: string, content: string, workspaceId?: WorkspaceId) =>
    brain.createKnowledge({ organizationId: org, title, content, type: "decision", createdBy: "user:test", workspaceId });

  return { brain, works, artifacts, write };
}

test("knowledge written by someone who may only propose it waits for review", async () => {
  const { brain } = setup();

  const proposed = await brain.createKnowledge({
    organizationId: org,
    title: "Refunds need a receipt",
    content: "Every refund needs the original receipt.",
    type: "policy",
    createdBy: "user:member",
    proposeOnly: true,
  });

  assert.equal(proposed.status, "proposed");
});

test("search, overview and a detail's related entries leave out workspaces the caller was not given", async () => {
  const { brain, write } = setup();
  const company = await write("Starter pricing is $99 per month", "The Starter plan costs $99 per month.");
  await write("Finance pricing floor is $79 per month", "Finance will not approve Starter pricing below $79 per month.", finance);

  const recent = await brain.search(org, {}, companyOnly);
  const relevant = await brain.search(org, { query: "starter pricing" }, companyOnly);
  const overview = await brain.getOverview(org, companyOnly);
  const detail = await brain.getDetail(org, company.id, companyOnly);

  for (const shown of [recent, relevant, overview, detail]) {
    assert.doesNotMatch(JSON.stringify(shown), /Finance pricing floor/);
  }

  assert.match(JSON.stringify(await brain.search(org, {})), /Finance pricing floor/);
  assert.equal(await brain.locateKnowledge(org, company.id), undefined);
});

test("an artifact from a mission in an unreachable workspace cannot be learned from", async () => {
  const { brain, works, artifacts } = setup();
  works.set("w-finance", { id: "w-finance" as WorkId, organizationId: org, workspaceId: finance } as Work);
  artifacts.set("a-finance", {
    id: "a-finance" as ArtifactId, organizationId: org, workId: "w-finance" as WorkId, name: "Budget", type: "analysis",
    version: 1, createdAt: now, updatedAt: now, metadata: { content: "Budget analysis." },
  } as Artifact);

  await assert.rejects(brain.deriveFromArtifact(org, "a-finance" as ArtifactId, "user:member", companyOnly), KnowledgeNotFoundError);
  await assert.doesNotReject(brain.deriveFromArtifact(org, "a-finance" as ArtifactId, "user:owner"));
});
