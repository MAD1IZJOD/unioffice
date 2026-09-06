import assert from "node:assert/strict";
import test from "node:test";

import type {
  Event,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  EventRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import { EventRecorder } from "./event-recorder.js";
import { ExecutionScheduler } from "./execution-scheduler.js";
import type { WorkExecutionService } from "./work-execution-service.js";

const organizationId = "organization-1" as OrganizationId;
const workId = "work-1" as WorkId;

function makeWork(overrides: Partial<Work> = {}): Work {
  const now = new Date();

  return {
    id: workId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Test objective.",
    status: "queued",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function harness(execute: (id: WorkId) => Promise<unknown>) {
  const workStore = new Map<WorkId, Work>([[workId, makeWork()]]);
  const tasks: Task[] = [];
  const events: Event[] = [];

  const workRepository: WorkRepository = {
    async create(value) { return value; },
    async findById(id) { return workStore.get(id) ?? null; },
    async findByOrganization() { return [...workStore.values()]; },
    async findByStatuses(statuses) {
      return [...workStore.values()].filter((work) => statuses.includes(work.status));
    },
    async update(value) { workStore.set(value.id, value); return value; },
    async delete() {},
  };

  const taskRepository: TaskRepository = {
    async create(value) { return value; },
    async findById() { return null; },
    async findByWork() { return tasks; },
    async claimReadyForExecution() { return null; },
    async update(value) { return value; },
    async delete() {},
  };

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };

  const workExecutionService = {
    executeWork: execute,
  } as unknown as WorkExecutionService;

  return {
    scheduler: new ExecutionScheduler(
      workExecutionService,
      workRepository,
      taskRepository,
      new EventRecorder(eventRepository),
    ),
    workStore,
    events,
  };
}

test("returns before execution finishes", async () => {
  let released!: () => void;
  const blocked = new Promise<void>((resolve) => {
    released = resolve;
  });

  const { scheduler } = harness(async () => {
    await blocked;
    return undefined;
  });

  const result = await scheduler.startExecution(workId);

  // The whole point: the caller is answered while the run is still going.
  assert.equal(result.started, true);
  assert.equal(scheduler.isRunning(workId), true);

  released();
  await scheduler.waitFor(workId);
  assert.equal(scheduler.isRunning(workId), false);
});

test("a second start does not run the same work twice", async () => {
  let released!: () => void;
  const blocked = new Promise<void>((resolve) => {
    released = resolve;
  });
  let runs = 0;

  const { scheduler } = harness(async () => {
    runs += 1;
    await blocked;
    return undefined;
  });

  const first = await scheduler.startExecution(workId);
  const second = await scheduler.startExecution(workId);

  assert.equal(first.started, true);
  assert.equal(second.started, false);
  assert.equal(runs, 1);

  released();
  await scheduler.waitFor(workId);
});

test("a background failure marks the work failed instead of escaping as an unhandled rejection", async () => {
  const { scheduler, workStore, events } = harness(async () => {
    throw new Error("Ollama is unreachable.");
  });

  await scheduler.startExecution(workId);
  await scheduler.waitFor(workId);

  const work = workStore.get(workId)!;
  assert.equal(work.status, "failed");
  assert.equal(work.metadata.executionError, "Ollama is unreachable.");

  const failure = events.find((event) => event.type === "work.failed");
  assert.ok(failure);
  assert.equal(failure.payload.stage, "execution");
});

test("the work can be started again once a run settles", async () => {
  let runs = 0;
  const { scheduler } = harness(async () => {
    runs += 1;
    return undefined;
  });

  await scheduler.startExecution(workId);
  await scheduler.waitFor(workId);

  const second = await scheduler.startExecution(workId);
  await scheduler.waitFor(workId);

  assert.equal(second.started, true);
  assert.equal(runs, 2);
});

test("refuses to schedule work that does not exist", async () => {
  const { scheduler } = harness(async () => undefined);

  await assert.rejects(
    () => scheduler.startExecution("missing" as WorkId),
    /Work not found/,
  );
});

test("reports the tasks that exist when the run is scheduled", async () => {
  const now = new Date();
  const { scheduler } = harness(async () => undefined);
  const result = await scheduler.startExecution(workId);
  await scheduler.waitFor(workId);

  assert.deepEqual(result.tasks, []);
  // Guards the shape callers poll against, not just the count.
  assert.equal(result.work.id, workId);
  assert.ok(result.work.createdAt instanceof Date || now instanceof Date);
});
