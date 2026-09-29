import assert from "node:assert/strict";
import test from "node:test";

import type { WorkStatus } from "@unioffice/core";

import { lifecycleStartability, startabilityOf } from "./mission-startability.js";

const ready = { blocked: false };

test("a planned mission that has not begun can be started", () => {
  assert.deepEqual(startabilityOf({ status: "queued" }, 3, ready), {
    startable: true,
    mode: "start",
    state: "ready",
    message: "Ready to run.",
  });
});

test("a begun mission left without a worker can be resumed", () => {
  assert.deepEqual(startabilityOf({ status: "executing" }, 3, ready), {
    startable: true,
    mode: "resume",
    state: "ready",
    message: "Ready to carry on from where it stopped.",
  });
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

test("a mission with a job already on the queue is running, not startable again", () => {
  for (const status of ["queued", "executing"] as WorkStatus[]) {
    const decision = startabilityOf({ status }, 3, ready, true);
    assert.equal(!decision.startable && decision.reason, "running", status);
  }
});

test("a finished mission with a stray job still reads as finished", () => {
  const decision = startabilityOf({ status: "completed" }, 3, ready, true);
  assert.equal(!decision.startable && decision.reason, "completed");
});

test("a limitation lets it start and says what may be missing", () => {
  const decision = startabilityOf({ status: "queued" }, 2, {
    blocked: false,
    limitation: "Mike is the closest match for step 1 but does not have market research.",
  });

  assert.deepEqual(decision, {
    startable: true,
    mode: "start",
    state: "limited",
    message: "Mike is the closest match for step 1 but does not have market research.",
  });
});

test("a step that waits for a person lets it start and says it will stop there", () => {
  const decision = startabilityOf({ status: "queued" }, 2, { blocked: false, approvals: 2 });

  assert.deepEqual(decision, {
    startable: true,
    mode: "start",
    state: "approval_required",
    message: "It will stop for approval at 2 steps.",
  });
});

test("a limit names the state when there is a gate too, and the gate is still said", () => {
  const decision = startabilityOf({ status: "queued" }, 2, {
    blocked: false,
    limitation: "The result may be less complete.",
    approvals: 1,
  });

  assert.equal(decision.startable && decision.state, "limited");
  assert.equal(decision.message, "The result may be less complete. It will stop for approval at 1 step.");
});

test("a blocker outranks an approval: a gate is never a reason to refuse on its own", () => {
  const decision = startabilityOf({ status: "queued" }, 2, { blocked: true, summary: "Tony is paused.", approvals: 1 });
  assert.equal(!decision.startable && decision.reason, "blocked");
});
