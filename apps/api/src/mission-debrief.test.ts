import assert from "node:assert/strict";
import test from "node:test";

import type {
  Agent,
  AgentId,
  Artifact,
  ArtifactId,
  Event,
  KnowledgeConflictId,
  Memory,
  MemoryId,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ArtifactRepository,
  EventRepository,
  PolicyRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import { InMemoryKnowledgeRepository } from "@unioffice/database";

import type { EmbeddingProvider } from "@unioffice/memory";

import { createDefaultToolRegistry } from "@unioffice/tools";

import { CompanyBrainService } from "./company-brain-service.js";
import { EventRecorder } from "./event-recorder.js";
import { GovernanceService } from "./governance-service.js";
import { KnowledgeCaptureService } from "./knowledge-capture-service.js";
import { KnowledgeGovernance } from "./knowledge-governance.js";
import { KnowledgeRecallService } from "./knowledge-recall-service.js";

/**
 * The mission debrief over the real Brain, recall and capture services.
 *
 * Only the embedding model is replaced, by one whose geometry is written down
 * here: churn findings point one way, upgrade findings sit at cosine 0.8 from
 * them - the same topic, a different finding - and onboarding is unrelated.
 */

const orgA = "aaaaaaaa-0000-0000-0000-000000000001" as OrganizationId;
const orgB = "bbbbbbbb-0000-0000-0000-000000000002" as OrganizationId;
const finance = "f0000000-0000-0000-0000-00000000000f" as WorkspaceId;
const legal = "10000000-0000-0000-0000-00000000000e" as WorkspaceId;
const missionId = "c0000000-0000-4000-8000-000000000001" as WorkId;
const taskId = "c0000000-0000-4000-8000-000000000002" as TaskId;
const artifactId = "c0000000-0000-4000-8000-000000000003" as ArtifactId;
const now = new Date();

const TOPICS: Array<[RegExp, number[]]> = [
  [/churn/i, [1, 0, 0, 0]],
  [/upgrade/i, [0.8, 0.6, 0, 0]],
  [/onboarding/i, [0, 0, 1, 0]],
];

const embedder: EmbeddingProvider = {
  model: "topic-test",
  dimensions: 4,
  async embed(texts) {
    return texts.map((text) => TOPICS.find(([pattern]) => pattern.test(text))?.[1] ?? [0, 0, 0, 1]);
  },
};

function setup(options: { embeddings?: boolean } = {}) {
  const store = new InMemoryKnowledgeRepository();
  const events: Event[] = [];
  const embeddings = options.embeddings === false ? undefined : embedder;

  const mission: Work = {
    id: missionId,
    organizationId: orgA,
    requesterId: "user" as Work["requesterId"],
    objective: "Revise the Starter pricing.",
    status: "completed",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
  const task: Task = {
    id: taskId,
    workId: missionId,
    title: "Analyse Starter churn",
    description: "",
    status: "completed",
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };
  const artifact = { id: artifactId, organizationId: orgA, name: "Churn analysis", type: "analysis" } as Artifact;
  const agents = new Map<string, Agent>([
    ["harvey", { id: "harvey" as AgentId, organizationId: orgA, name: "Harvey", description: "", type: "specialist", status: "active", capabilities: [], toolIds: [], createdAt: now, updatedAt: now, metadata: {} }],
    ["intruder", { id: "intruder" as AgentId, organizationId: orgB, name: "Intruder", description: "", type: "specialist", status: "active", capabilities: [], toolIds: [], createdAt: now, updatedAt: now, metadata: {} }],
  ]);

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };
  const workRepository = { async findById(id: WorkId) { return id === missionId ? mission : null; } } as unknown as WorkRepository;
  const taskRepository = { async findById(id: TaskId) { return id === taskId ? task : null; } } as unknown as TaskRepository;
  const artifactRepository = { async findById(id: ArtifactId) { return id === artifactId ? artifact : null; } } as unknown as ArtifactRepository;
  const agentRepository = { async findById(id: AgentId) { return agents.get(id) ?? null; } } as unknown as AgentRepository;
  const workspaceRepository = { async findById() { return null; } } as unknown as WorkspaceRepository;
  const policyRepository = { async findEnforced() { return []; }, async findByOrganization() { return []; } } as unknown as PolicyRepository;

  const recorder = new EventRecorder(eventRepository);
  const governance = new KnowledgeGovernance(
    policyRepository,
    new GovernanceService(policyRepository, createDefaultToolRegistry(), recorder),
  );
  const recall = new KnowledgeRecallService(store, store, governance, recorder, workRepository, taskRepository, artifactRepository, embeddings);
  const capture = new KnowledgeCaptureService(store, store, governance, recorder, undefined, embeddings);
  const brain = new CompanyBrainService(
    store, store, recall, capture, recorder,
    workRepository, taskRepository, artifactRepository, workspaceRepository, agentRepository,
  );

  async function seed(overrides: Partial<Memory>): Promise<Memory> {
    const memory = await store.create({
      id: crypto.randomUUID() as MemoryId,
      organizationId: orgA,
      scope: "company",
      type: "fact",
      status: "active",
      title: "Knowledge",
      content: "Knowledge.",
      sourceType: "user",
      importance: 0.6,
      createdAt: now,
      updatedAt: now,
      metadata: {},
      ...overrides,
    });

    if (embeddings) {
      const [vector] = await embeddings.embed([`${memory.title}\n\n${memory.content}`], "document");
      await store.setEmbedding(memory.organizationId, memory.id, vector!, embeddings.model);
    }

    return memory;
  }

  /** Something this mission's analysis step proposed. */
  function learned(overrides: Partial<Memory>): Promise<Memory> {
    return seed({
      status: "proposed",
      sourceType: "task",
      workId: missionId,
      taskId,
      agentId: "harvey" as AgentId,
      artifactId,
      title: "Most Starter churn happens in the second month",
      content: "Starter customers churn most in their second month.",
      metadata: { extraction: { rationale: "Retention offers should land before month two." } },
      ...overrides,
    });
  }

  return { store, brain, recall, seed, learned, events };
}

test("each lesson is shown with its evidence, next to the knowledge it restates", async () => {
  const { brain, seed, learned } = setup();
  const known = await seed({ title: "Starter churn peaks in month two", content: "Churn on Starter is highest in month two.", reviewedAt: now });
  const upgrades = await seed({ title: "Starter customers often upgrade to Growth", content: "Many Starter accounts upgrade within a quarter." });
  await seed({ title: "Onboarding checklist for Starter", content: "Send the onboarding checklist on day one." });
  const lesson = await learned({});

  const { review } = await brain.getMissionKnowledge(orgA, missionId);

  assert.equal(review.length, 1);
  const [item] = review;
  assert.equal(item!.knowledge.id, lesson.id);
  assert.equal(item!.outcome, "pending");
  assert.deepEqual(item!.evidence, {
    task: { id: taskId, title: "Analyse Starter churn" },
    agent: { id: "harvey", name: "Harvey" },
    artifact: { id: artifactId, name: "Churn analysis" },
    rationale: "Retention offers should land before month two.",
  });

  assert.deepEqual(
    item!.related.map((entry) => [entry.knowledge.id, entry.relation, entry.similarity, entry.canMerge]),
    [
      [known.id, "restates", 1, true],
      [upgrades.id, "related", 0.8, true],
    ],
    "same topic but a different finding is related, not a restatement; the unrelated note is absent",
  );
});

test("an open contradiction is shown as one, and is not also offered as a restatement", async () => {
  const { brain, store, seed, learned } = setup();
  const known = await seed({ title: "Starter churn peaks in month three", content: "Churn on Starter is highest in month three." });
  const lesson = await learned({});

  await store.createConflict({
    id: crypto.randomUUID() as KnowledgeConflictId,
    organizationId: orgA,
    memoryId: lesson.id,
    conflictingMemoryId: known.id,
    reason: "Month two vs month three.",
    signals: {},
    status: "open",
    detectedAt: now,
  });

  const { review } = await brain.getMissionKnowledge(orgA, missionId);

  assert.deepEqual(
    review[0]!.related.map((entry) => [entry.knowledge.id, entry.relation, entry.canMerge]),
    [[known.id, "contradicts", false]],
  );
});

test("decided items say what became of them, from the records themselves", async () => {
  const { brain, seed, learned } = setup();
  const known = await seed({ title: "Starter churn peaks in month two", content: "Churn on Starter is highest in month two." });
  const olderDecision = await seed({ type: "decision", title: "Starter price stays at 99 for upgrade campaigns", content: "The upgrade campaign keeps the 99 price." });

  const merged = await learned({});
  const kept = await learned({ type: "decision", title: "Starter upgrade campaigns now use 109", content: "Upgrade campaigns moved to the 109 price." });
  const discarded = await learned({ title: "Onboarding emails were sent", content: "Onboarding emails went out on Monday." });

  await brain.mergeKnowledge(orgA, merged.id, known.id, "user:reviewer");
  await brain.supersedeKnowledge(orgA, kept.id, olderDecision.id, "user:reviewer");
  await brain.archiveKnowledge(orgA, discarded.id, { by: "user:reviewer", reason: "Not durable." });

  const { review } = await brain.getMissionKnowledge(orgA, missionId);
  const byId = new Map(review.map((item) => [item.knowledge.id, item]));

  assert.equal(byId.get(merged.id)!.outcome, "merged");
  assert.deepEqual(byId.get(merged.id)!.mergedInto, { id: known.id, title: known.title, status: "active" });

  assert.equal(byId.get(kept.id)!.outcome, "kept");
  assert.deepEqual(byId.get(kept.id)!.replaces, { id: olderDecision.id, title: olderDecision.title, status: "archived" });

  assert.equal(byId.get(discarded.id)!.outcome, "discarded");

  for (const item of review) {
    assert.deepEqual(item.related, [], "a decided item is not compared again");
  }
});

test("evidence and relations stay inside the organization and the workspace", async () => {
  const { brain, seed, learned } = setup();
  const companyWide = await seed({ title: "Starter churn peaks in month two", content: "Churn on Starter is highest in month two." });
  await seed({ organizationId: orgB, title: "Their Starter churn peaks in month two", content: "Churn is highest in month two." });
  await seed({ workspaceId: legal, title: "Legal Starter churn note", content: "Churn noted by legal." });
  const financeOnly = await seed({ workspaceId: finance, title: "Finance Starter churn note", content: "Churn tracked by finance." });

  // A finance lesson whose recorded agent belongs to another organization.
  const financeLesson = await learned({ workspaceId: finance, agentId: "intruder" as AgentId });
  const companyLesson = await learned({ title: "Starter churn is concentrated in month two", content: "Starter churn is concentrated in month two." });

  const { review } = await brain.getMissionKnowledge(orgA, missionId);
  const byId = new Map(review.map((item) => [item.knowledge.id, item]));

  const finance_ = byId.get(financeLesson.id)!;
  assert.equal(finance_.evidence.agent, undefined, "an agent from another organization is never named");
  assert.deepEqual(
    new Set(finance_.related.map((entry) => entry.knowledge.id)),
    new Set([companyWide.id, financeOnly.id, companyLesson.id]),
    "never another organization's knowledge, and never another workspace's",
  );

  const company = byId.get(companyLesson.id)!;
  const intoFinance = company.related.find((entry) => entry.knowledge.id === financeOnly.id)!;
  assert.equal(intoFinance.canMerge, false, "company-wide knowledge is not offered a merge into one workspace's entry");
  assert.equal(company.related.find((entry) => entry.knowledge.id === companyWide.id)!.canMerge, true);
});

test("legacy execution records are not put up for review", async () => {
  const { brain, learned } = setup();
  await learned({ type: "experience", status: "archived", title: "Task outcome: 64 times 9", content: "64 times 9 is 576." });
  const lesson = await learned({});

  const { review, learned: all } = await brain.getMissionKnowledge(orgA, missionId);

  assert.equal(all.length, 2, "the mission's full record is unchanged");
  assert.deepEqual(review.map((item) => item.knowledge.id), [lesson.id]);
});

test("without embeddings, only an identical title counts as a restatement", async () => {
  const { brain, seed, learned } = setup({ embeddings: false });
  const same = await seed({ title: "Most Starter churn happens in the second month.", content: "Recorded by a person." });
  const similar = await seed({ title: "Starter churn peaks in month two", content: "Starter churn is highest in the second month." });
  await learned({});

  const { review } = await brain.getMissionKnowledge(orgA, missionId);
  const relations = new Map(review[0]!.related.map((entry) => [entry.knowledge.id, entry]));

  assert.equal(relations.get(same.id)!.relation, "restates");
  assert.equal(relations.get(same.id)!.similarity, undefined);
  assert.equal(relations.get(similar.id)?.relation, "related", "wording alone is not proof of a restatement");
});

/* --------------------------------------------------------------------------
   The loop: what a debrief decides is what the next plan is handed
   -------------------------------------------------------------------------- */

test("after a merge, the next mission's planning is handed the knowledge once, confirmed by the mission that re-learned it", async () => {
  const { brain, recall, store, seed, learned } = setup();
  const known = await seed({ title: "Starter churn peaks in month two", content: "Churn on Starter is highest in month two.", reviewedAt: now });
  const lesson = await learned({});

  const next: Work = {
    id: "d0000000-0000-4000-8000-000000000001" as WorkId,
    organizationId: orgA,
    requesterId: "user" as Work["requesterId"],
    objective: "Plan a retention campaign for Starter churn.",
    status: "planning",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
  };

  // Before anyone decides, planning is handed the same finding twice.
  const before = await recall.recallForPlanning(next);
  assert.deepEqual(new Set(before.items.map((item) => item.id)), new Set([known.id, lesson.id]));

  const { review } = await brain.getMissionKnowledge(orgA, missionId);
  const restatement = review[0]!.related.find((relation) => relation.relation === "restates")!;
  assert.equal(restatement.knowledge.id, known.id);

  await brain.mergeKnowledge(orgA, lesson.id, restatement.knowledge.id, "user:reviewer");

  const after = await recall.recallForPlanning(next);
  assert.deepEqual(
    after.items.map((item) => [item.id, item.status, item.reviewed]),
    [[known.id, "active", true]],
    "one current, reviewed entry instead of an unreviewed restatement beside it",
  );
  assert.ok(
    store.recalls.some((entry) => entry.workId === next.id && entry.memoryId === known.id && entry.stage === "planning"),
    "the next mission's record says what its plan was given",
  );

  const detail = await brain.getDetail(orgA, known.id);
  assert.deepEqual(
    detail.confirmations.map((entry) => [entry.mission?.id, entry.wording]),
    [[missionId, lesson.title]],
  );
  assert.equal((await brain.getDetail(orgA, lesson.id)).related.mergedInto?.id, known.id);
});

test("a confirmation never names a mission from outside the organization", async () => {
  const { brain, store, seed } = setup();
  const known = await seed({
    title: "Starter churn peaks in month two",
    content: "Churn on Starter is highest in month two.",
    metadata: {
      reinforcements: [{ knowledgeId: "x", workId: "e0000000-0000-4000-8000-00000000000e", title: "Their wording", mergedAt: now.toISOString() }],
    },
  });

  const detail = await brain.getDetail(orgA, known.id);

  assert.equal(detail.confirmations.length, 1);
  assert.equal(detail.confirmations[0]!.mission, undefined);
  assert.ok(await store.findById(known.id));
});
