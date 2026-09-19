import assert from "node:assert/strict";
import test from "node:test";

import type { WorkId } from "@unioffice/core";

import { MissionLauncher } from "./mission-launcher.js";

const mission = "aaaaaaaa-0000-4000-8000-000000000001" as WorkId;

/** What planning returns when it has left the mission waiting to run. */
const waiting = { work: { status: "queued" } };

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

test("a launch returns before planning finishes, then plans and queues on its own", async () => {
  const steps: string[] = [];
  const planning = gate();

  const launcher = new MissionLauncher({
    async planWork() { steps.push("plan started"); await planning.opened; steps.push("plan finished"); return waiting; },
    async enqueueWork() { steps.push("queued"); },
  });

  const { started, settled } = launcher.launch(mission);

  assert.equal(started, true);
  assert.deepEqual(steps, ["plan started"], "the caller is not kept waiting for the plan");
  assert.equal(launcher.isLaunching(mission), true);

  planning.open();
  await settled;

  assert.deepEqual(steps, ["plan started", "plan finished", "queued"], "queueing follows planning without anyone asking");
  assert.equal(launcher.isLaunching(mission), false);
});

test("the same mission is not launched twice while one launch is in flight", async () => {
  let plans = 0;
  const planning = gate();

  const launcher = new MissionLauncher({
    async planWork() { plans += 1; await planning.opened; return waiting; },
    async enqueueWork() {},
  });

  const first = launcher.launch(mission);
  const second = launcher.launch(mission);

  assert.equal(first.started, true);
  assert.equal(second.started, false);

  planning.open();
  await first.settled;

  assert.equal(plans, 1);
  assert.equal(launcher.launch(mission).started, true, "once it has settled it can be launched again");
});

test("a failed plan is reported and nothing is queued", async () => {
  const errors: string[] = [];
  let queued = false;

  const launcher = new MissionLauncher({
    async planWork() { throw new Error("model unavailable"); },
    async enqueueWork() { queued = true; },
    onError(_workId, stage, error) { errors.push(`${stage}: ${(error as Error).message}`); },
  });

  await launcher.launch(mission).settled;

  assert.equal(queued, false);
  assert.deepEqual(errors, ["planning: model unavailable"]);
  assert.equal(launcher.isLaunching(mission), false, "a failure does not leave the mission locked");
});

test("a failure to queue is reported, and settling never throws", async () => {
  const errors: string[] = [];

  const launcher = new MissionLauncher({
    async planWork() { return waiting; },
    async enqueueWork() { throw new Error("queue unreachable"); },
    onError(_workId, stage, error) { errors.push(`${stage}: ${(error as Error).message}`); },
  });

  await assert.doesNotReject(launcher.launch(mission).settled);
  assert.deepEqual(errors, ["queueing: queue unreachable"]);
});

test("a mission cancelled while it was being planned is not queued", async () => {
  let queued = false;

  const launcher = new MissionLauncher({
    async planWork() { return { work: { status: "cancelled" } }; },
    async enqueueWork() { queued = true; },
  });

  await launcher.launch(mission).settled;

  assert.equal(queued, false, "the cancellation stands");
});

