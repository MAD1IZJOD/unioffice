import assert from "node:assert/strict";
import test from "node:test";

import type { KnowledgeConflictId } from "@unioffice/core";

import { MissionNotFoundError, MissionStateError } from "./mission-control-service.js";
import { asOwner, missionControlFixture, orgA, orgB } from "./mission-control.fixture.js";
import { MODEL_UNAVAILABLE_REASON } from "./public-failure.js";

/**
 * Mission Control over the production service and in-memory stores: what it
 * says is running, blocked, finished and needing a person, and that it never
 * says anything about another organization or hands out what it should not.
 */

test("an empty company reads as empty, not as broken", async () => {
  const { service } = missionControlFixture();

  const view = await service.getMissionControl(orgA, asOwner);

  assert.deepEqual(view.running, []);
  assert.deepEqual(view.blocked, []);
  assert.deepEqual(view.finished, []);
  assert.deepEqual(view.outcomes, []);
  assert.equal(view.attention.total, 0);
  assert.deepEqual(view.summary, { running: 0, blocked: 0, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 0, total: 0 });
});

test("a running mission shows its current step, its team, its progress and its latest meaningful event", async () => {
  const f = missionControlFixture();
  const harvey = f.agent("Harvey");
  const mike = f.agent("Mike");
  const mission = f.work("Review Q3 burn", { status: "executing", startedAt: f.ago(6), updatedAt: f.ago(1) });
  f.task(mission, "Gather figures", { status: "completed", assignedAgentId: mike.id, updatedAt: f.ago(3) });
  const draft = f.task(mission, "Draft the review", { status: "running", assignedAgentId: harvey.id, updatedAt: f.ago(1) });
  f.task(mission, "Check the arithmetic", { status: "pending", assignedAgentId: harvey.id });
  f.job(mission, { status: "running", attempts: 1, updatedAt: f.ago(1) });
  f.event({ type: "agent.assigned", workId: mission.id, timestamp: f.ago(0.5) });
  f.event({ type: "task.started", workId: mission.id, taskId: draft.id, agentId: harvey.id, payload: { title: "Draft the review" }, timestamp: f.ago(1) });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.equal(view.running.length, 1);
  const [card] = view.running;
  assert.equal(card!.phase, "running");
  assert.equal(card!.stage, "Working on “Draft the review”");
  assert.deepEqual(card!.currentSteps, ["Draft the review"]);
  assert.deepEqual(card!.progress, { total: 3, completed: 1, running: 1, failed: 0 });
  assert.deepEqual(card!.team.map((member) => [member.name, member.state]), [["Mike", "done"], ["Harvey", "working"]]);
  assert.equal(card!.latest?.text, "Harvey started “Draft the review”", "machinery events such as agent.assigned are not the latest meaningful event");
  assert.ok((card!.elapsedMs ?? 0) >= 6 * 60_000);
  assert.equal(view.summary.running, 1);
  assert.equal(view.workforce.working, 1);
  assert.deepEqual(view.workforce.roster.map((member) => [member.name, member.status]), [["Harvey", "active"], ["Mike", "active"]]);
  assert.equal(view.attention.total, 0, "normal execution stays quiet");
});

test("a queued mission a worker has not reached yet is waiting, and one no worker ever reaches is stalled", async () => {
  const f = missionControlFixture();
  const fresh = f.work("Fresh on the queue", { updatedAt: f.ago(2) });
  f.task(fresh, "Step", { updatedAt: f.ago(2) });
  f.job(fresh, { updatedAt: f.ago(2) });

  const forgotten = f.work("Forgotten on the queue", { updatedAt: f.ago(120) });
  f.task(forgotten, "Step", { updatedAt: f.ago(120) });
  f.job(forgotten, { updatedAt: f.ago(120) });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.deepEqual(view.running.map((card) => [card.objective, card.phase, card.stage]), [["Fresh on the queue", "queued", "Waiting for a worker"]]);
  assert.deepEqual(view.blocked.map((card) => [card.objective, card.phase, card.blocked?.reason]), [
    ["Forgotten on the queue", "stalled", "On the queue for 2 hours; no worker has picked it up."],
  ]);

  const item = view.attention.items.find((entry) => entry.workId === forgotten.id)!;
  assert.equal(item.kind, "stalled");
  assert.equal(item.severity, "action");
  assert.equal(item.source, "queue");
  assert.deepEqual(item.action, { label: "Open mission", path: `/missions/${forgotten.id}` });
  assert.equal(item.acknowledgeable, true);
});

test("every way a mission can stop moving without telling anyone is named for what it is", async () => {
  const f = missionControlFixture();
  f.work("Never planned", { status: "queued", updatedAt: f.ago(180) });
  const planned = f.work("Planned, never queued", { status: "queued", updatedAt: f.ago(60) });
  f.task(planned, "Step", { updatedAt: f.ago(60) });
  f.work("Stuck planning", { status: "planning", updatedAt: f.ago(90) });
  const midRun = f.work("Stopped mid-run", { status: "executing", updatedAt: f.ago(40) });
  f.task(midRun, "Step", { status: "ready", updatedAt: f.ago(40) });
  const retrying = f.work("Retrying", { status: "executing", updatedAt: f.ago(50) });
  f.job(retrying, { attempts: 1, lastError: "Ollama request failed (500): {\"error\":\"llama-server\"}", updatedAt: f.ago(50) });

  const view = await f.service.getMissionControl(orgA, asOwner);
  const reasons = Object.fromEntries(view.blocked.map((card) => [card.objective, card.blocked?.reason]));

  assert.deepEqual(reasons, {
    "Never planned": "Opened 3 hours ago and never planned.",
    "Planned, never queued": "Planned 60 minutes ago but never put on the queue.",
    "Stuck planning": "Planning started 90 minutes ago and never finished.",
    "Stopped mid-run": "Stopped mid-run 40 minutes ago with nothing on the queue to resume it.",
  });

  // A retry waiting out its backoff is the queue doing its job, not a stall.
  const retry = view.running.find((card) => card.objective === "Retrying")!;
  assert.equal(retry.stage, "Waiting to retry (attempt 2)");
  const watching = view.attention.items.find((item) => item.kind === "recovering")!;
  assert.equal(watching.severity, "watch");
  assert.equal(watching.detail, MODEL_UNAVAILABLE_REASON);
});

test("a mission waiting for a decision is blocked on that decision, and the decision leads the queue", async () => {
  const f = missionControlFixture();
  const mission = f.work("Launch the campaign", { status: "waiting_approval", updatedAt: f.ago(20) });
  const step = f.task(mission, "Send the announcement", { status: "waiting", updatedAt: f.ago(20) });
  f.approval(mission, step, { reason: "This contacts every customer." });
  f.work("Stopped earlier", { status: "failed", completedAt: f.ago(5), updatedAt: f.ago(5), metadata: { executionError: "Task failed: Draft" } });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.deepEqual(view.blocked.map((card) => [card.phase, card.stage, card.blocked]), [
    ["waiting_approval", "Waiting for a decision on “Send the announcement”", { kind: "approval", reason: "This contacts every customer." }],
  ]);

  const [first, second] = view.attention.items;
  assert.equal(first!.kind, "decision");
  assert.equal(first!.label, "Send the announcement");
  assert.deepEqual(first!.action, { label: "Review", path: `/missions/${mission.id}` });
  assert.equal(first!.acknowledgeable, false, "a decision is answered by deciding");
  assert.equal(second!.kind, "failure");
  assert.equal(view.summary.needsYou, 2);
});

test("a failure is shown with a reason a person can read, and a policy stop names the policy", async () => {
  const f = missionControlFixture();
  const crashed = f.work("Crashed", {
    status: "failed",
    completedAt: f.ago(3),
    updatedAt: f.ago(3),
    metadata: { executionError: "Ollama request failed (500): {\"error\":\"llama-server process has terminated: exit status 1: ggml_backend_cpu_buffer_type_alloc_buffer: failed\"}" },
  });
  const unroutable = f.work("Unroutable", {
    status: "failed",
    completedAt: f.ago(4),
    updatedAt: f.ago(4),
    metadata: { planningError: "No eligible agent is authorized for the required tool(s): calculator (task: c26cc1d4-d59b-4733-a26e-61d02fd4f0dc)" },
  });
  const denied = f.work("Denied", { status: "failed", completedAt: f.ago(2), updatedAt: f.ago(2), metadata: { executionError: "Task failed: Buy ads" } });
  f.event({
    type: "task.failed",
    workId: denied.id,
    payload: { title: "Buy ads", error: "Spending money is not permitted.", governance: { outcome: "denied", policyName: "No external spend" } },
    timestamp: f.ago(2),
  });

  const view = await f.service.getMissionControl(orgA, asOwner);
  const items = new Map(view.attention.items.map((item) => [item.workId, item]));

  assert.equal(items.get(crashed.id)!.detail, MODEL_UNAVAILABLE_REASON);
  assert.equal(items.get(unroutable.id)!.label, "Planning failed");
  assert.equal(items.get(unroutable.id)!.source, "planning");
  assert.equal(items.get(unroutable.id)!.detail, "No eligible agent is authorized for the required tool(s): calculator.");
  assert.equal(items.get(denied.id)!.kind, "governance");
  assert.equal(items.get(denied.id)!.label, "Stopped by No external spend");
  assert.equal(items.get(denied.id)!.detail, "Spending money is not permitted.");

  assert.equal(view.finished.find((card) => card.id === crashed.id)!.failure, MODEL_UNAVAILABLE_REASON);
  assert.doesNotMatch(JSON.stringify(view), /llama-server|ggml|c26cc1d4/);
  assert.equal(view.summary.failedToday, 3);
});

test("a step assigned to an agent who cannot work is the obstacle named, with the agent as the place to act", async () => {
  const f = missionControlFixture();
  const rhea = f.agent("Rhea", { status: "paused" });
  const mission = f.work("Research the market", { status: "executing", updatedAt: f.ago(2) });
  f.task(mission, "Interview customers", { status: "ready", assignedAgentId: rhea.id, updatedAt: f.ago(2) });
  f.job(mission, { status: "queued", updatedAt: f.ago(2) });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.equal(view.blocked[0]!.blocked?.kind, "agent_unavailable");
  assert.equal(view.blocked[0]!.blocked?.reason, "“Interview customers” is assigned to Rhea, who is paused.");
  assert.deepEqual(view.blocked[0]!.team, [{ agentId: rhea.id, name: "Rhea", state: "unavailable" }]);

  const item = view.attention.items[0]!;
  assert.equal(item.kind, "agent_unavailable");
  assert.equal(item.source, "workforce");
  assert.deepEqual(item.action, { label: "Review agent", path: `/workforce/${rhea.id}` });
  assert.deepEqual(view.workforce.unavailable, [{ agentId: rhea.id, name: "Rhea", status: "paused" }]);
});

test("marking a stalled mission as seen clears it from the queue until something about it changes", async () => {
  const f = missionControlFixture();
  const stale = f.work("A test left behind", { status: "queued", updatedAt: f.ago(600) });

  const before = await f.service.getMissionControl(orgA, asOwner);
  assert.equal(before.summary.blocked, 1);

  const result = await f.service.acknowledge(orgA, stale.id, "user:1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09");
  assert.deepEqual(result.acknowledgedAt, f.now);

  const after = await f.service.getMissionControl(orgA, asOwner);
  assert.equal(after.attention.total, 0);
  assert.equal(after.summary.blocked, 0);
  assert.equal(after.summary.setAside, 1);

  const row = f.works.find((entry) => entry.id === stale.id)!;
  assert.deepEqual(row.updatedAt, stale.updatedAt, "marking as seen is not activity");
  assert.equal(row.status, "queued", "nothing else about the mission changes");

  const recorded = f.events.find((entry) => entry.type === "work.acknowledged")!;
  assert.equal(recorded.workId, stale.id);
  assert.equal(recorded.actorType, "user");
  assert.equal(recorded.actorId, "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09");

  // The mission moves and then stops again: that is new, so it is raised again.
  row.updatedAt = new Date(f.now.getTime() + 60_000);
  const later = await f.service.getAttention(orgA, asOwner);
  assert.equal(later.total, 0, "not yet stalled again");
});

test("a failure marked as seen comes back if the mission fails again after it", async () => {
  const f = missionControlFixture();
  const mission = f.work("Flaky", { status: "failed", completedAt: f.ago(30), updatedAt: f.ago(30), metadata: { executionError: "Task failed: Step" } });

  await f.service.acknowledge(orgA, mission.id, "user:x");
  assert.equal((await f.service.getAttention(orgA, asOwner)).total, 0);

  const row = f.works.find((entry) => entry.id === mission.id)!;
  row.completedAt = new Date(f.now.getTime() + 5 * 60_000);

  assert.equal((await f.service.getAttention(orgA, asOwner)).items[0]?.kind, "failure");
});

test("only a mission that is genuinely not moving can be marked as seen, and never another organization's", async () => {
  const f = missionControlFixture();
  const theirs = f.work("Theirs", { organizationId: orgB, status: "failed", completedAt: f.ago(10) });
  const deciding = f.work("Deciding", { status: "waiting_approval", updatedAt: f.ago(100) });
  const onQueue = f.work("On the queue", { status: "queued", updatedAt: f.ago(100) });
  f.job(onQueue, { updatedAt: f.ago(100) });
  const moving = f.work("Moving", { status: "executing", updatedAt: f.ago(3) });
  const finished = f.work("Finished", { status: "completed", completedAt: f.ago(3) });

  await assert.rejects(f.service.acknowledge(orgA, theirs.id, "user:x"), MissionNotFoundError);
  await assert.rejects(f.service.acknowledge(orgA, crypto.randomUUID() as never, "user:x"), MissionNotFoundError);
  await assert.rejects(f.service.acknowledge(orgA, deciding.id, "user:x"), /waiting for a decision/);
  await assert.rejects(f.service.acknowledge(orgA, onQueue.id, "user:x"), /on the queue/);
  await assert.rejects(f.service.acknowledge(orgA, moving.id, "user:x"), MissionStateError);
  await assert.rejects(f.service.acknowledge(orgA, finished.id, "user:x"), /finished mission/);

  assert.ok(f.works.every((entry) => entry.metadata.acknowledged === undefined), "a refused request changes nothing");
  assert.equal(f.events.length, 0);
});

test("recent outcomes are business outcomes: completions carry their artifacts, and machinery is left out", async () => {
  const f = missionControlFixture();
  const done = f.work("Write the board note", { status: "completed", completedAt: f.ago(5) });
  const busy = f.work("Still producing", { status: "executing", updatedAt: f.ago(1) });
  const knowledgeId = crypto.randomUUID();

  f.event({ type: "task.ready", workId: done.id, timestamp: f.ago(9) });
  f.event({ type: "artifact.created", workId: done.id, payload: { name: "Draft" }, timestamp: f.ago(8) });
  f.event({ type: "artifact.created", workId: done.id, payload: { name: "Final" }, timestamp: f.ago(6) });
  f.event({ type: "work.completed", workId: done.id, payload: { taskCount: 2 }, timestamp: f.ago(5) });
  f.event({ type: "artifact.created", workId: busy.id, payload: { name: "Part one" }, timestamp: f.ago(4) });
  f.event({ type: "artifact.created", workId: busy.id, payload: { name: "Part two" }, timestamp: f.ago(3) });
  f.event({ type: "approval.approved", workId: busy.id, payload: { title: "Spend the budget" }, timestamp: f.ago(2) });
  f.event({ type: "knowledge.approved", payload: { title: "Launches need legal sign-off", knowledgeId }, timestamp: f.ago(1) });
  f.event({ type: "tool.completed", workId: busy.id, payload: { toolId: "calculator", input: "SECRET-INPUT", output: "SECRET-OUTPUT" }, timestamp: f.ago(0.5) });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.deepEqual(
    view.outcomes.map((outcome) => [outcome.kind, outcome.text, outcome.note ?? null, outcome.path ?? null]),
    [
      ["knowledge", "Kept as company knowledge: “Launches need legal sign-off”", null, `/brain/${knowledgeId}`],
      ["decision", "Approved “Spend the budget”", null, `/missions/${busy.id}`],
      ["artifacts", "Produced 2 artifacts", null, `/missions/${busy.id}`],
      ["mission_completed", "Mission finished", "2 steps · 2 artifacts", `/missions/${done.id}`],
    ],
  );
  assert.doesNotMatch(JSON.stringify(view), /SECRET-INPUT|SECRET-OUTPUT/);
});

test("company signals are short: recent decisions and lessons, what awaits a decision, and open disagreements", async () => {
  const f = missionControlFixture();
  const mission = f.work("Revise pricing", { status: "completed", completedAt: f.ago(10) });
  await f.memory({ type: "decision", title: "Starter stays at 99", content: "A long content body that is never sent." });
  await f.memory({ type: "lesson", status: "proposed", title: "Churn peaks in month two", workId: mission.id, sourceType: "task" });
  await f.memory({ type: "fact", status: "proposed", title: "Two tiers exist", workId: mission.id, sourceType: "task" });
  const left = await f.memory({ title: "Launch sign-off is manual" });
  const right = await f.memory({ title: "Launch sign-off is automated" });
  await f.knowledge.createConflict({
    id: crypto.randomUUID() as KnowledgeConflictId,
    organizationId: orgA,
    memoryId: left.id,
    conflictingMemoryId: right.id,
    reason: "Manual versus automated.",
    signals: {},
    status: "open",
    detectedAt: f.ago(2),
  });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.deepEqual(view.signals.decisions.map((signal) => signal.title), ["Starter stays at 99"]);
  assert.deepEqual(view.signals.lessons.map((signal) => [signal.title, signal.status]), [["Churn peaks in month two", "proposed"]]);
  assert.deepEqual(view.signals.awaiting, { total: 2, atLeast: false, missions: [{ workId: mission.id, objective: "Revise pricing", count: 2 }] });
  assert.deepEqual(view.signals.conflicts, [{
    id: view.signals.conflicts[0]!.id,
    reason: "Manual versus automated.",
    left: { id: left.id, title: "Launch sign-off is manual" },
    right: { id: right.id, title: "Launch sign-off is automated" },
  }]);
  assert.doesNotMatch(JSON.stringify(view), /never sent/);

  // Neither blocks anything, so both are for review, below anything stopped.
  assert.deepEqual(view.attention.items.map((item) => [item.kind, item.severity]), [["conflict", "review"], ["lessons", "review"]]);
  assert.equal(view.attention.actionCount, 0);
  assert.equal(view.attention.reviewCount, 2);
  assert.deepEqual(view.attention.items[1]!.action, { label: "Decide", path: `/missions/${mission.id}#debrief` });
});

test("a problem on a critical mission is a critical problem, and ranks first", async () => {
  const f = missionControlFixture();
  f.work("Ordinary failure", { status: "failed", completedAt: f.ago(1), updatedAt: f.ago(1), metadata: { executionError: "Task failed: A" } });
  f.work("Critical stall", { status: "queued", priority: "critical", updatedAt: f.ago(300) });

  const { items } = await f.service.getAttention(orgA, asOwner);

  assert.deepEqual(items.map((item) => [item.objective, item.level]), [["Critical stall", "critical"], ["Ordinary failure", "high"]]);
});

test("nothing from another organization appears anywhere, however it is related", async () => {
  const f = missionControlFixture();
  const outsider = f.agent("Outsider", { organizationId: orgB, status: "disabled" });
  const theirs = f.work("THEIR-OBJECTIVE", { organizationId: orgB, status: "waiting_approval", updatedAt: f.ago(500) });
  const theirStep = f.task(theirs, "THEIR-STEP", { status: "waiting", assignedAgentId: outsider.id });
  f.approval(theirs, theirStep);
  f.job(theirs, { attempts: 2, lastError: "THEIR-ERROR" });
  f.work("THEIR-FAILURE", { organizationId: orgB, status: "failed", completedAt: f.ago(1) });
  f.event({ type: "work.completed", organizationId: orgB, workId: theirs.id, timestamp: f.ago(1) });
  await f.memory({ organizationId: orgB, type: "decision", title: "THEIR-DECISION" });
  await f.memory({ organizationId: orgB, status: "proposed", title: "THEIR-LESSON", workId: theirs.id });

  const view = await f.service.getMissionControl(orgA, asOwner);

  assert.doesNotMatch(JSON.stringify(view), /THEIR-|Outsider/);
  assert.equal(view.attention.total, 0);
  assert.equal(view.workforce.total, 0);
  assert.deepEqual(view.summary, { running: 0, blocked: 0, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 0, total: 0 });
});
