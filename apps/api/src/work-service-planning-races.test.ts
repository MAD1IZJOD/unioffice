import assert from "node:assert/strict";
import test from "node:test";

import type { Agent, AgentId, OrganizationId, Task, UserId, Work, WorkId, WorkStatus } from "@unioffice/core";

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

/** A work service over an in-memory mission, with a planner we can interrupt. */
function planningHarness(options: { startingStatus: WorkStatus; duringPlan?: (setStatus: (status: WorkStatus) => void) => void }) {
  const organizationId = "bbbbbbbb-0000-4000-8000-000000000002" as OrganizationId;
  let stored: Work = {
    id: mission,
    organizationId,
    requesterId: "cccccccc-0000-4000-8000-000000000003" as UserId,
    objective: "Review Q3 spending",
    status: options.startingStatus,
    priority: "normal",
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {},
  };
  const writes: WorkStatus[] = [];
  const created: Task[] = [];

  const agent = {
    id: "dddddddd-0000-4000-8000-000000000004" as AgentId,
    organizationId,
    name: "Ledger",
    status: "active",
    type: "specialist",
    capabilities: ["financial_analysis"],
    toolIds: ["calculator"],
    skills: [],
    metadata: {},
  } as unknown as Agent;

  const service = new WorkService(
    {
      async findById() { return { ...stored }; },
      async update(next: Work) { writes.push(next.status); stored = { ...next }; return { ...next }; },
    } as never,
    { async create(task: Task) { created.push(task); return task; } } as never,
    { async findByOrganization() { return [agent]; } } as never,
    {
      async plan() {
        options.duringPlan?.((status) => { stored = { ...stored, status }; });
        return {
          workId: mission,
          summary: "one step",
          tasks: [{ id: "eeeeeeee-0000-4000-8000-000000000005", ref: "a", title: "Analyse", description: "Analyse it", dependsOn: [], requiredTools: [], requiredCapabilities: [], metadata: {} }],
          metadata: {},
        };
      },
    } as never,
    { async delegate(context: { task: { id: string } }) { return { taskId: context.task.id, agentId: agent.id, metadata: {} }; } } as never,
    { async record(event: unknown) { return event; } } as never,
  );

  return { service, writes, created, current: () => stored };
}

test("a mission cancelled while its plan was being written stays cancelled, with nothing created", async () => {
  const { service, writes, created, current } = planningHarness({
    startingStatus: "planning",
    duringPlan: (setStatus) => setStatus("cancelled"),
  });

  const result = await service.planWork(mission);

  assert.equal(result.work.status, "cancelled");
  assert.equal(current().status, "cancelled", "the cancellation is not overwritten");
  assert.deepEqual(created, [], "no steps are created for a cancelled mission");
  assert.equal(writes.includes("queued"), false, "it is not put back to waiting");
});

test("a mission a launch already marked as planning is not written again when planning starts", async () => {
  const { service, writes } = planningHarness({ startingStatus: "planning" });

  const result = await service.planWork(mission);

  assert.equal(result.work.status, "queued", "planned and waiting to run");
  assert.deepEqual(writes, ["queued"], "only the finished plan is written, never a second planning mark");
});

test("planning a waiting mission still marks it as planning first, as before", async () => {
  const { service, writes } = planningHarness({ startingStatus: "queued" });

  await service.planWork(mission);

  assert.deepEqual(writes, ["planning", "queued"]);
});

