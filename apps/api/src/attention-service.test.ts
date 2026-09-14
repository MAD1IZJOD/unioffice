import assert from "node:assert/strict";
import test from "node:test";

import type {
  AgentId,
  ApprovalId,
  ApprovalRequest,
  ExecutionJob,
  ExecutionJobId,
  KnowledgeConflictId,
  MemoryId,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

import type { WorkSummary } from "@unioffice/database";

import { buildAttentionQueue, type AttentionInput } from "./attention-service.js";
import { readMission } from "./mission-reading.js";

/**
 * The ranking and shaping rules of the attention queue, on their own. The
 * loading side - which rows are read, and the tenant boundary - is covered by
 * the Mission Control service tests.
 */

const organizationId = "org-1" as OrganizationId;
const now = new Date("2026-09-14T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

function summary(id: string, overrides: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id: id as WorkId,
    organizationId,
    objective: `Objective ${id}`,
    status: "completed",
    priority: "normal",
    createdAt: minutesAgo(10),
    updatedAt: minutesAgo(1),
    interrupted: false,
    ...overrides,
  };
}

function approval(id: string, workId: string, overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: id as ApprovalId,
    organizationId,
    workId: workId as WorkId,
    taskId: "t1" as ApprovalRequest["taskId"],
    action: "Send the launch email",
    resource: "task:t1",
    reason: "This would contact customers directly.",
    status: "pending",
    createdAt: minutesAgo(2),
    metadata: {},
    ...overrides,
  };
}

function job(id: string, workId: string, overrides: Partial<ExecutionJob> = {}): ExecutionJob {
  return {
    id: id as ExecutionJobId,
    organizationId,
    workId: workId as WorkId,
    status: "queued",
    reason: "requested",
    attempts: 0,
    maxAttempts: 3,
    runAt: minutesAgo(1),
    createdAt: minutesAgo(1),
    updatedAt: minutesAgo(1),
    metadata: {},
    ...overrides,
  };
}

function queue(fixture: {
  works?: WorkSummary[];
  approvals?: ApprovalRequest[];
  jobs?: ExecutionJob[];
  denials?: AttentionInput["denials"];
  conflicts?: AttentionInput["conflicts"];
  lessons?: AttentionInput["lessons"];
}, limit?: number) {
  const works = fixture.works ?? [];

  return buildAttentionQueue({
    approvals: fixture.approvals ?? [],
    worksById: new Map(works.map((work) => [work.id, work])),
    missions: works.map((work) => ({
      work,
      reading: readMission({ work, tasks: [], approvals: [], agents: new Map(), now, stalledAfterMs: 15 * 60_000 }),
    })),
    jobs: fixture.jobs ?? [],
    denials: fixture.denials ?? new Map(),
    conflicts: fixture.conflicts ?? [],
    lessons: fixture.lessons ?? [],
    agentIds: new Set<AgentId>(),
  }, limit);
}

test("a company with nothing wrong has an empty queue, and says so cleanly", () => {
  const result = queue({ works: [summary("w1")] });

  assert.deepEqual(result, { items: [], actionCount: 0, reviewCount: 0, watchCount: 0, total: 0 });
});

test("a pending approval is an action, and names the mission it stopped", () => {
  const result = queue({
    approvals: [approval("ap1", "w1")],
    works: [summary("w1", { objective: "Prepare the launch", status: "waiting_approval" })],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.kind, "decision");
  assert.equal(result.items[0]?.severity, "action");
  assert.equal(result.items[0]?.source, "approval");
  assert.equal(result.items[0]?.objective, "Prepare the launch");
  assert.deepEqual(result.items[0]?.action, { label: "Review", path: "/missions/w1" });
});

test("an interrupted run is not filed as a failure", () => {
  const result = queue({ works: [summary("w1", { status: "failed", interrupted: true })] });

  assert.equal(result.items[0]?.kind, "interrupted");
  assert.equal(result.items[0]?.action.label, "Resume");
  assert.match(result.items[0]?.consequence ?? "", /Resuming picks up/);
});

test("a retrying job is information rather than something to do, and says why in words", () => {
  const result = queue({
    works: [summary("w1", { status: "executing" })],
    jobs: [job("j1", "w1", { attempts: 1, lastError: "Ollama was unreachable: fetch failed" })],
  });

  assert.equal(result.items[0]?.kind, "recovering");
  assert.equal(result.items[0]?.severity, "watch");
  assert.equal(result.items[0]?.detail, "The local model was unavailable when this ran.");
  assert.equal(result.actionCount, 0);
  assert.equal(result.watchCount, 1);
});

test("a job on its first attempt, or already running, is not recovery", () => {
  const result = queue({
    works: [summary("w1", { status: "executing" })],
    jobs: [job("j1", "w1"), job("j2", "w1", { status: "running", attempts: 2 })],
  });

  assert.deepEqual(result.items, []);
});

test("an entry whose mission or knowledge cannot be read is dropped, not shown blank", () => {
  const result = queue({
    jobs: [job("j1", "deleted", { attempts: 1 })],
    lessons: [{ workId: "deleted" as WorkId, count: 2, at: now }],
    conflicts: [{
      conflict: {
        id: "c1" as KnowledgeConflictId,
        organizationId,
        memoryId: "m1" as MemoryId,
        conflictingMemoryId: "m2" as MemoryId,
        reason: "",
        signals: {},
        status: "open",
        detectedAt: now,
      },
      left: { id: "m1" as MemoryId, title: "One side" },
    }],
  });

  assert.deepEqual(result.items, []);
});

test("things that are stopped outrank things to review, which outrank the system recovering itself", () => {
  const result = queue({
    approvals: [approval("ap1", "w3")],
    works: [
      summary("w1", { status: "failed", executionError: "boom" }),
      summary("w2", { status: "executing" }),
      summary("w3", { status: "waiting_approval" }),
      summary("w4"),
    ],
    jobs: [job("j1", "w2", { attempts: 1 })],
    lessons: [{ workId: "w4" as WorkId, count: 1, at: now }],
  });

  assert.deepEqual(
    result.items.map((item) => [item.kind, item.severity]),
    [["decision", "action"], ["failure", "action"], ["lessons", "review"], ["recovering", "watch"]],
  );
});

test("within one kind the newest comes first", () => {
  const result = queue({
    works: [
      summary("old", { status: "failed", completedAt: minutesAgo(180) }),
      summary("new", { status: "failed", completedAt: minutesAgo(60) }),
    ],
  });

  assert.deepEqual(result.items.map((item) => item.workId), ["new", "old"]);
});

test("the returned list is capped but the counts are honest about the rest", () => {
  const result = queue({
    works: Array.from({ length: 8 }, (_, index) => summary(`w${index}`, { status: "failed" })),
  }, 3);

  assert.equal(result.items.length, 3);
  assert.equal(result.total, 8);
  assert.equal(result.actionCount, 8);
});
