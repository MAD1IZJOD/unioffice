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

import {
  ALLOWS_EVERYTHING,
  buildAttentionQueue,
  type AttentionAuthority,
  type AttentionInput,
} from "./attention-service.js";
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
  schedules?: AttentionInput["schedules"];
  authority?: AttentionAuthority;
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
    schedules: fixture.schedules,
    authority: fixture.authority ?? ALLOWS_EVERYTHING,
  }, limit);
}

test("a company with nothing wrong has an empty queue, and says so cleanly", () => {
  const result = queue({ works: [summary("w1")] });

  assert.deepEqual(result, {
    items: [],
    actionCount: 0,
    waitingOnOthersCount: 0,
    reviewCount: 0,
    watchCount: 0,
    total: 0,
  });
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

/* --------------------------------------------------------------------------
   Who the queue is for
   -------------------------------------------------------------------------- */

/** An authority that refuses everything, the way a viewer's does. */
const ALLOWS_NOTHING: AttentionAuthority = {
  decide: () => ({ allowed: false, handoff: "Someone else needs to handle this." }),
};

/** Refuses one permission and allows the rest, the way a member's does. */
function allowsAllBut(
  permission: "missions.operate" | "knowledge.curate" | "agents.configure",
): AttentionAuthority {
  return {
    decide: (need) =>
      need.of === "permission" && need.permission === permission
        ? { allowed: false, handoff: `Someone who can ${permission} handles this.` }
        : { allowed: true },
  };
}

test("an entry someone cannot act on keeps its place and says whose it is", () => {
  const result = queue({
    approvals: [approval("ap1", "w1")],
    works: [summary("w1", { status: "waiting_approval" })],
    authority: ALLOWS_NOTHING,
  });

  assert.equal(result.items.length, 1, "it is still shown - they can see what is holding the company up");
  assert.equal(result.items[0]?.actionable, false);
  assert.equal(result.items[0]?.handoff, "Someone else needs to handle this.");
});

test("what needs you counts only what you can actually do", () => {
  const result = queue({
    approvals: [approval("ap1", "w1")],
    works: [summary("w1", { status: "waiting_approval" })],
    authority: ALLOWS_NOTHING,
  });

  assert.equal(result.actionCount, 0, "a badge saying one thing needs them would not be true");
  assert.equal(result.waitingOnOthersCount, 1);
  assert.equal(result.total, 1);
});

test("the same queue read by someone who may act counts it as theirs", () => {
  const result = queue({
    approvals: [approval("ap1", "w1")],
    works: [summary("w1", { status: "waiting_approval" })],
  });

  assert.equal(result.items[0]?.actionable, true);
  assert.equal(result.items[0]?.handoff, undefined);
  assert.equal(result.actionCount, 1);
  assert.equal(result.waitingOnOthersCount, 0);
});

test("a step a policy stopped asks for approval, and says so as its own need", () => {
  const needs: Array<Record<string, unknown>> = [];

  queue({
    approvals: [
      approval("ap1", "w1", { metadata: { policyId: "p1" } }),
      approval("ap2", "w1"),
    ],
    works: [summary("w1", { status: "waiting_approval" })],
    authority: { decide: (need) => { needs.push(need); return { allowed: true }; } },
  });

  assert.deepEqual(
    needs.map((need) => [need.of, need.governedByPolicy]),
    [["approval", true], ["approval", false]],
  );
});

test("a mission entry asks to operate missions, in the mission's own workspace", () => {
  const needs: Array<Record<string, unknown>> = [];
  const finance = "f0000000-0000-4000-8000-00000000000f";

  queue({
    works: [summary("w1", { status: "failed", workspaceId: finance as never })],
    authority: { decide: (need) => { needs.push(need); return { allowed: true }; } },
  });

  // The second is the queue asking whether they may also set it aside.
  assert.deepEqual(needs[0], { of: "permission", permission: "missions.operate", workspaceId: finance });
});

test("settling what the company knows is asked of knowledge, not of missions", () => {
  const needs: Array<Record<string, unknown>> = [];

  queue({
    conflicts: [{
      conflict: {
        id: "c1" as KnowledgeConflictId,
        organizationId,
        memoryId: "m1" as MemoryId,
        conflictingMemoryId: "m2" as MemoryId,
        reason: "They state different amounts for the same subject.",
        signals: {},
        status: "open",
        detectedAt: minutesAgo(5),
      },
      left: { id: "m1" as MemoryId, title: "Enterprise pricing is 100000" },
      right: { id: "m2" as MemoryId, title: "Enterprise pricing is 120000" },
    }],
    authority: { decide: (need) => { needs.push(need); return { allowed: true }; } },
  });

  assert.deepEqual(needs[0], { of: "permission", permission: "knowledge.curate", workspaceId: undefined });
});

test("someone who may run missions but not curate knowledge is told which is theirs", () => {
  const result = queue({
    works: [summary("w1", { status: "failed" })],
    lessons: [{ workId: "w1" as WorkId, count: 2, at: minutesAgo(4) }],
    authority: allowsAllBut("knowledge.curate"),
  });

  const byKind = new Map(result.items.map((item) => [item.kind, item]));

  assert.equal(byKind.get("failure")?.actionable, true);
  assert.equal(byKind.get("lessons")?.actionable, false);
  assert.match(byKind.get("lessons")?.handoff ?? "", /knowledge\.curate/);
});

test("marking a mission as seen is withheld from someone who may not operate it", () => {
  const result = queue({
    works: [summary("w1", { status: "failed" })],
    authority: allowsAllBut("missions.operate"),
  });

  assert.equal(result.items[0]?.kind, "failure");
  assert.equal(result.items[0]?.actionable, false);
  assert.equal(result.items[0]?.acknowledgeable, false, "setting it aside is an operator's act too");
});

test("a job the system is retrying asks nothing of anybody, whoever is reading", () => {
  const result = queue({
    works: [summary("w1", { status: "executing" })],
    jobs: [job("j1", "w1", { attempts: 1 })],
    authority: ALLOWS_NOTHING,
  });

  assert.equal(result.items[0]?.kind, "recovering");
  assert.equal(result.items[0]?.actionable, true);
  assert.equal(result.items[0]?.handoff, undefined, "nothing is waiting on a person, so nobody is named");
});

/* --------------------------------------------------------------------------
   The company not being set up
   -------------------------------------------------------------------------- */

test("a mission nobody is authorized to do is a setup problem, not a mission problem", () => {
  const result = queue({
    works: [summary("w1", {
      status: "failed",
      completedAt: minutesAgo(5),
      executionError: "No eligible agent is authorized for the required tool(s): calculator (task: 7f9c2b10-0000-4000-8000-00000000000a)",
    })],
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.kind, "configuration");
  assert.equal(result.items[0]?.source, "workforce");
  assert.equal(result.items[0]?.label, "Nobody is set up to use the calculator");
  assert.deepEqual(result.items[0]?.action, { label: "Set up the workforce", path: "/workforce" });
  assert.match(result.items[0]?.consequence ?? "", /Every mission needing this stops the same way/);
});

test("a company with nobody in it is told that, rather than shown a tool it lacks", () => {
  const result = queue({
    works: [summary("w1", {
      status: "failed",
      completedAt: minutesAgo(5),
      executionError: "No active agent is available for task: 7f9c2b10-0000-4000-8000-00000000000a",
    })],
  });

  assert.equal(result.items[0]?.kind, "configuration");
  assert.equal(result.items[0]?.label, "Nobody is set up to do this work");
  assert.match(result.items[0]?.consequence ?? "", /until somebody works here/);
});

test("an ordinary stop is still an ordinary stop, pointing at the mission", () => {
  const result = queue({
    works: [summary("w1", {
      status: "failed",
      completedAt: minutesAgo(5),
      executionError: "llama-server process has terminated: exit status 1",
    })],
  });

  assert.equal(result.items[0]?.kind, "failure");
  assert.deepEqual(result.items[0]?.action, { label: "Inspect", path: "/missions/w1" });
});

test("a step a policy stopped stays a governance problem even when a tool is named", () => {
  const result = queue({
    works: [summary("w1", {
      status: "failed",
      completedAt: minutesAgo(5),
      executionError: "No eligible agent is authorized for the required tool(s): calculator",
    })],
    denials: new Map([["w1" as WorkId, { policyName: "Spending rule", summary: "Payments need a person." }]]),
  });

  assert.equal(result.items[0]?.kind, "governance");
});

test("a setup problem asks to configure agents, not to run missions", () => {
  const needs: Array<Record<string, unknown>> = [];

  queue({
    works: [summary("w1", {
      status: "failed",
      completedAt: minutesAgo(5),
      executionError: "No eligible agent is authorized for the required tool(s): calculator",
    })],
    authority: { decide: (need) => { needs.push(need); return { allowed: true }; } },
  });

  assert.ok(needs.some((need) => need.permission === "agents.configure"));
});

test("a setup problem outranks an ordinary failure, because fixing it clears more than one", () => {
  const result = queue({
    works: [
      summary("plain", { status: "failed", completedAt: minutesAgo(1), executionError: "It threw." }),
      summary("setup", {
        status: "failed",
        completedAt: minutesAgo(90),
        executionError: "No eligible agent is authorized for the required tool(s): calculator",
      }),
    ],
  });

  assert.deepEqual(result.items.map((item) => item.kind), ["configuration", "failure"]);
});

test("someone who may run missions but not configure agents is told whose setup problem it is", () => {
  const result = queue({
    works: [summary("w1", {
      status: "failed",
      completedAt: minutesAgo(5),
      executionError: "No eligible agent is authorized for the required tool(s): calculator",
    })],
    authority: allowsAllBut("agents.configure"),
  });

  assert.equal(result.items[0]?.actionable, false);
  assert.equal(result.items[0]?.acknowledgeable, true, "they may still set the mission aside");
});

/* --------------------------------------------------------------------------
   Continuous missions
   -------------------------------------------------------------------------- */

const pricingRun = { continuousMissionId: "cm-1", name: "Competitor pricing watch", sequence: 3 };

test("a run's approval says which continuous mission and which run it is", () => {
  const result = queue({
    approvals: [approval("ap1", "w1", { action: "Send the pricing report outside the company" })],
    works: [summary("w1", { status: "waiting_approval", run: pricingRun })],
  });

  const [entry] = result.items;
  assert.equal(entry?.kind, "decision");
  assert.deepEqual(entry?.run, pricingRun);
  assert.equal(entry?.continuousMissionId, "cm-1");
  assert.equal(entry?.actionable, true);
});

test("a failed run is an ordinary mission failure that still names its run", () => {
  const result = queue({
    works: [summary("w1", { status: "failed", executionError: "Task failed: Compare prices", completedAt: minutesAgo(3), run: pricingRun })],
  });

  assert.equal(result.items[0]?.kind, "failure");
  assert.equal(result.items[0]?.run?.sequence, 3);
});

test("a continuous mission that stopped itself needs a person, above a single failure", () => {
  const result = queue({
    works: [summary("w1", { status: "failed", executionError: "Task failed: something", completedAt: minutesAgo(3) })],
    schedules: [{ id: "cm-1", name: "Competitor pricing watch", reason: "repeated_failures", at: minutesAgo(5) }],
  });

  assert.deepEqual(result.items.map((item) => item.kind), ["schedule", "failure"]);

  const [entry] = result.items;
  assert.equal(entry?.severity, "action");
  assert.match(entry?.label ?? "", /“Competitor pricing watch” stopped running/);
  assert.match(entry?.detail ?? "", /failed one after another/);
  assert.match(entry?.consequence ?? "", /No more runs start/);
  assert.deepEqual(entry?.action, { label: "Review schedule", path: "/schedules/cm-1" });
  assert.equal(entry?.acknowledgeable, false);
});

test("one that stopped because its owner lost access says so", () => {
  const result = queue({
    schedules: [{ id: "cm-2", name: "Weekly close", reason: "owner_access", at: minutesAgo(1) }],
  });

  assert.match(result.items[0]?.detail ?? "", /can no longer start missions there/);
});

test("a stopped schedule is resumed by whoever may operate missions in its workspace", () => {
  const needs: unknown[] = [];

  queue({
    schedules: [{ id: "cm-1", name: "Watch", workspaceId: "ws-finance" as never, reason: "repeated_failures", at: minutesAgo(1) }],
    authority: { decide: (need) => { needs.push(need); return { allowed: true }; } },
  });

  assert.deepEqual(needs[0], { of: "permission", permission: "missions.operate", workspaceId: "ws-finance" });

  const viewer = queue({
    schedules: [{ id: "cm-1", name: "Watch", reason: "repeated_failures", at: minutesAgo(1) }],
    authority: allowsAllBut("missions.operate"),
  });

  assert.equal(viewer.items[0]?.actionable, false);
  assert.match(viewer.items[0]?.handoff ?? "", /missions.operate/);
  assert.equal(viewer.actionCount, 0);
  assert.equal(viewer.waitingOnOthersCount, 1);
});
