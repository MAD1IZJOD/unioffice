import assert from "node:assert/strict";
import test from "node:test";

import type { WorkStatus } from "@unioffice/core";

import { lifecycleStartability, startabilityOf } from "./mission-startability.js";

const ready = { blocked: false };

test("a planned mission that has not begun can be started", () => {
  assert.deepEqual(startabilityOf({ status: "queued" }, 3, ready), { startable: true, mode: "start" });
});

test("a begun mission left without a worker can be resumed", () => {
  assert.deepEqual(startabilityOf({ status: "executing" }, 3, ready), { startable: true, mode: "resume" });
});

test("a mission with no plan has nothing to run", () => {
  const decision = startabilityOf({ status: "queued" }, 0, ready);
  assert.equal(decision.startable, false);
  assert.equal(!decision.startable && decision.reason, "not_planned");
});

test("finished, cancelled and failed missions are never started again from here", () => {
  for (const status of ["completed", "cancelled", "failed"] as WorkStatus[]) {
    const decision = startabilityOf({ status }, 3, ready);
    assert.equal(decision.startable, false, status);
    assert.equal(!decision.startable && decision.reason, status);
  }
});

test("planning and waiting on a decision are not a start either", () => {
  assert.equal(lifecycleStartability({ status: "planning" }, 0).startable, false);
  assert.equal(lifecycleStartability({ status: "waiting_approval" }, 3).startable, false);
});

test("a blocker the preflight found refuses, in the preflight's words", () => {
  const decision = startabilityOf({ status: "queued" }, 2, {
    blocked: true,
    summary: "Tony is paused, so step 2 has nobody to run it.",
  });

  assert.deepEqual(decision, {
    startable: false,
    reason: "blocked",
    message: "Tony is paused, so step 2 has nobody to run it.",
  });
});

test("the lifecycle answers before readiness is consulted", () => {
  const decision = startabilityOf({ status: "completed" }, 2, { blocked: true, summary: "irrelevant" });
  assert.equal(!decision.startable && decision.reason, "completed");
});
