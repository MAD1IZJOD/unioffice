import assert from "node:assert/strict";
import test from "node:test";

import type { Task, TaskId, TaskStatus, WorkId } from "@unioffice/core";

import { buildExecutionPlan } from "./execution-plan.js";

const workId = "work-1" as WorkId;

function task(
  id: string,
  options: {
    status?: TaskStatus;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
    startedAt?: Date;
    completedAt?: Date;
  } = {},
): Task {
  return {
    id: id as TaskId,
    workId,
    title: `Task ${id}`,
    description: `What ${id} does`,
    status: options.status ?? "pending",
    dependsOn: (options.dependsOn ?? []) as TaskId[],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    metadata: options.metadata ?? {},
  };
}

function nodeOf(plan: ReturnType<typeof buildExecutionPlan>, id: string) {
  const node = plan.nodes.find((candidate) => candidate.taskId === id);
  assert.ok(node, `expected a node for ${id}`);
  return node;
}

test("an empty plan is empty rather than zero-divided", () => {
  const plan = buildExecutionPlan([]);

  assert.equal(plan.totalCount, 0);
  assert.equal(plan.progress, 0);
  assert.equal(plan.widestLane, 0);
  assert.deepEqual(plan.lanes, []);
  assert.equal(plan.hasCycle, false);
});

test("independent steps share a lane, which is what makes them parallel", () => {
  const plan = buildExecutionPlan([task("a"), task("b"), task("c")]);

  assert.equal(plan.lanes.length, 1);
  assert.deepEqual(plan.lanes[0]?.taskIds, ["a", "b", "c"]);
  assert.equal(plan.widestLane, 3);
});

test("a step sits one lane below its deepest dependency, not its first", () => {
  // c depends on both a (depth 0) and b (depth 1), so it belongs at 2.
  // Taking the first dependency would have put it at 1, next to the step it
  // is waiting for.
  const plan = buildExecutionPlan([
    task("a"),
    task("b", { dependsOn: ["a"] }),
    task("c", { dependsOn: ["a", "b"] }),
  ]);

  assert.equal(nodeOf(plan, "a").depth, 0);
  assert.equal(nodeOf(plan, "b").depth, 1);
  assert.equal(nodeOf(plan, "c").depth, 2);
});

test("names what is holding a step, and stops naming it once that finishes", () => {
  const blocked = buildExecutionPlan([
    task("research", { status: "running" }),
    task("finance", { dependsOn: ["research"] }),
  ]);

  assert.deepEqual(nodeOf(blocked, "finance").blockedBy, ["research"]);
  assert.equal(nodeOf(blocked, "finance").readiness, "blocked");

  const freed = buildExecutionPlan([
    task("research", { status: "completed" }),
    task("finance", { dependsOn: ["research"] }),
  ]);

  assert.deepEqual(nodeOf(freed, "finance").blockedBy, []);
  assert.equal(nodeOf(freed, "finance").readiness, "ready");
});

test("records which steps a step is holding up, not only what holds it", () => {
  const plan = buildExecutionPlan([
    task("research"),
    task("finance", { dependsOn: ["research"] }),
    task("brief", { dependsOn: ["research"] }),
  ]);

  assert.deepEqual(nodeOf(plan, "research").blocks, ["finance", "brief"]);
  assert.deepEqual(plan.terminalTaskIds, ["finance", "brief"]);
});

test("readiness follows the executor, not the dependency graph, once a step is live", () => {
  const plan = buildExecutionPlan([
    task("done", { status: "completed" }),
    task("running", { status: "running" }),
    task("waiting", { status: "waiting" }),
    task("failed", { status: "failed" }),
    task("cancelled", { status: "cancelled" }),
  ]);

  assert.equal(nodeOf(plan, "done").readiness, "done");
  assert.equal(nodeOf(plan, "running").readiness, "running");
  assert.equal(nodeOf(plan, "waiting").readiness, "waiting");
  assert.equal(nodeOf(plan, "failed").readiness, "failed");
  assert.equal(nodeOf(plan, "cancelled").readiness, "cancelled");
});

test("a dependency the planner invented is dropped rather than blocking forever", () => {
  const plan = buildExecutionPlan([
    task("real", { dependsOn: ["a-task-that-was-never-created"] }),
  ]);

  assert.deepEqual(nodeOf(plan, "real").dependsOn, []);
  assert.equal(nodeOf(plan, "real").readiness, "ready");
  assert.equal(plan.hasCycle, false);
});

test("a step depending on itself is not treated as blocking itself", () => {
  const plan = buildExecutionPlan([task("loop", { dependsOn: ["loop"] })]);

  assert.deepEqual(nodeOf(plan, "loop").dependsOn, []);
  assert.equal(plan.hasCycle, false);
});

test("a dependency cycle is reported, and the plan still renders", () => {
  const plan = buildExecutionPlan([
    task("a", { dependsOn: ["b"] }),
    task("b", { dependsOn: ["a"] }),
    task("c"),
  ]);

  assert.equal(plan.hasCycle, true);
  assert.equal(plan.nodes.length, 3);
  assert.equal(nodeOf(plan, "c").depth, 0);

  // Neither side of the cycle is laid out on top of the step that did settle.
  assert.ok(nodeOf(plan, "a").depth > 0);
  assert.ok(nodeOf(plan, "b").depth > 0);
});

test("progress counts completed steps and nothing else", () => {
  const plan = buildExecutionPlan([
    task("a", { status: "completed" }),
    task("b", { status: "running" }),
    task("c", { status: "failed" }),
    task("d"),
  ]);

  assert.equal(plan.completedCount, 1);
  assert.equal(plan.failedCount, 1);
  assert.equal(plan.runningCount, 1);
  assert.equal(plan.progress, 25);
});

test("reads tool calls and routing requirements off the task metadata", () => {
  const plan = buildExecutionPlan([
    task("a", {
      metadata: {
        execution: { toolCalls: [{ toolId: "calculator" }, { toolId: "datetime" }] },
        routing: {
          requiredTools: ["calculator"],
          requiredCapabilities: ["calculation", 7],
        },
      },
    }),
  ]);

  const node = nodeOf(plan, "a");

  assert.equal(node.toolCallCount, 2);
  assert.deepEqual(node.requiredTools, ["calculator"]);
  // The non-string is dropped rather than rendered as "7".
  assert.deepEqual(node.requiredCapabilities, ["calculation"]);
});

test("a step held by a pending approval says so", () => {
  const plan = buildExecutionPlan(
    [task("a", { status: "waiting" }), task("b")],
    { awaitingApprovalTaskIds: ["a" as TaskId] },
  );

  assert.equal(nodeOf(plan, "a").awaitingApproval, true);
  assert.equal(nodeOf(plan, "b").awaitingApproval, false);
});

test("duration is measured only when the step genuinely started and finished", () => {
  const plan = buildExecutionPlan([
    task("finished", {
      status: "completed",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      completedAt: new Date("2026-01-01T00:00:12.000Z"),
    }),
    task("mid", {
      status: "running",
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  ]);

  assert.equal(nodeOf(plan, "finished").durationMs, 12_000);
  assert.equal(nodeOf(plan, "mid").durationMs, undefined);
});
