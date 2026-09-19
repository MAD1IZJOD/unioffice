import assert from "node:assert/strict";
import test from "node:test";

import type { Work, WorkId, WorkStatus } from "@unioffice/core";

import { WorkService } from "./work-service.js";

const mission = "aaaaaaaa-0000-4000-8000-000000000001" as WorkId;

function serviceOver(repository: object): WorkService {
  return new WorkService(repository as never, {} as never, {} as never, {} as never, {} as never, {} as never);
}

test("starting a plan is one conditional write when the repository can do it", async () => {
  const transitions: Array<[WorkStatus, WorkStatus]> = [];
  let current: WorkStatus = "queued";

  const service = serviceOver({
    async transitionStatus(_id: WorkId, from: WorkStatus, to: WorkStatus) {
      transitions.push([from, to]);
      if (current !== from) return null;
      current = to;
      return { id: mission, status: to } as Work;
    },
    async update() { throw new Error("a whole-row update must not be used here"); },
  });

  assert.equal(await service.beginPlanning(mission), true);
  assert.equal(current, "planning");
  assert.deepEqual(transitions, [["queued", "planning"]]);

  assert.equal(await service.beginPlanning(mission), false, "a mission already planning is not started again");
});

test("a mission that is no longer waiting is not started", async () => {
  const service = serviceOver({
    async transitionStatus() { return null; },
  });

  assert.equal(await service.beginPlanning(mission), false);
});

test("without a conditional write it still refuses anything not waiting", async () => {
  const updates: WorkStatus[] = [];
  let status: WorkStatus = "cancelled";

  const service = serviceOver({
    async findById() { return { id: mission, status } as Work; },
    async update(work: Work) { updates.push(work.status); return work; },
  });

  assert.equal(await service.beginPlanning(mission), false);
  assert.deepEqual(updates, [], "a cancelled mission is left alone");

  status = "queued";
  assert.equal(await service.beginPlanning(mission), true);
  assert.deepEqual(updates, ["planning"]);
});
