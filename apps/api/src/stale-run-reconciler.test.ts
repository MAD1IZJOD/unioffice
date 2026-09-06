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
import { StaleRunReconciler } from "./stale-run-reconciler.js";

const organizationId = "organization-1" as OrganizationId;
const NOW = new Date("2026-09-06T12:00:00.000Z");
const LONG_AGO = new Date("2026-09-06T11:00:00.000Z");
const MOMENTS_AGO = new Date("2026-09-06T11:59:00.000Z");

function makeWork(overrides: Partial<Work> = {}): Work {
  return {
    id: "work-1" as WorkId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Test objective.",
    status: "executing",
    priority: "normal",
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    metadata: {},
    ...overrides,
  };
}

function makeTask(
  id: string,
  status: Task["status"],
  workId: WorkId = "work-1" as WorkId,
): Task {
  return {
    id: id as TaskId,
    workId,
    title: `Task ${id}`,
    description: "Task description.",
    status,
    dependsOn: [],
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    result: status === "completed" ? "A durable result." : undefined,
    metadata: {},
  };
}

function harness(works: Work[], tasks: Task[]) {
  const workStore = new Map<WorkId, Work>(works.map((work) => [work.id, work]));
  const taskStore = new Map<TaskId, Task>(tasks.map((task) => [task.id, task]));
  const events: Event[] = [];

  const workRepository: WorkRepository = {
    async create(value) { return value; },
    async findById(id) { return workStore.get(id) ?? null; },
    async findByOrganization() { return [...workStore.values()]; },
    async findByStatuses(statuses) {
      return [...workStore.values()].filter((work) =>
        statuses.includes(work.status),
      );
    },
    async update(value) { workStore.set(value.id, value); return value; },
    async delete() {},
  };

  const taskRepository: TaskRepository = {
    async create(value) { taskStore.set(value.id, value); return value; },
    async findById(id) { return taskStore.get(id) ?? null; },
    async findByWork(workId) {
      return [...taskStore.values()].filter((task) => task.workId === workId);
    },
    async claimReadyForExecution() { return null; },
    async update(value) { taskStore.set(value.id, value); return value; },
    async delete() {},
  };

  const eventRepository: EventRepository = {
    async create(event) { events.push(event); return event; },
    async findByWork() { return events; },
    async findByOrganization() { return events; },
  };

  return {
    reconciler: new StaleRunReconciler(
      workRepository,
      taskRepository,
      new EventRecorder(eventRepository),
      15 * 60 * 1000,
      () => NOW,
    ),
    workStore,
    taskStore,
    events,
  };
}

test("fails an abandoned run so it lands on the existing retry path", async () => {
  const { reconciler, workStore, taskStore } = harness(
    [makeWork()],
    [makeTask("task-running", "running"), makeTask("task-done", "completed")],
  );

  const result = await reconciler.reconcile();

  assert.equal(result.recoveredWork.length, 1);
  assert.equal(result.interruptedTaskCount, 1);

  const work = workStore.get("work-1" as WorkId)!;
  assert.equal(work.status, "failed");
  assert.match(String(work.metadata.executionError), /interrupted by an API restart/i);

  // Retry only accepts failed work, so this is what makes the run recoverable.
  assert.equal(taskStore.get("task-running" as TaskId)!.status, "failed");
});

test("leaves completed and pending tasks untouched", async () => {
  const { reconciler, taskStore } = harness(
    [makeWork()],
    [
      makeTask("task-done", "completed"),
      makeTask("task-waiting", "pending"),
      makeTask("task-running", "running"),
    ],
  );

  await reconciler.reconcile();

  assert.equal(taskStore.get("task-done" as TaskId)!.status, "completed");
  assert.equal(taskStore.get("task-done" as TaskId)!.result, "A durable result.");
  // Never started, so retry picks it up as-is.
  assert.equal(taskStore.get("task-waiting" as TaskId)!.status, "pending");
});

test("reclaims a task that was ready but never picked up", async () => {
  const { reconciler, taskStore } = harness(
    [makeWork()],
    [makeTask("task-ready", "ready")],
  );

  const result = await reconciler.reconcile();

  assert.equal(result.interruptedTaskCount, 1);
  assert.equal(taskStore.get("task-ready" as TaskId)!.status, "failed");
});

test("does not touch a run another process may still be executing", async () => {
  // A real objective takes minutes, so recent work is assumed live rather
  // than abandoned. Stealing it would kill a healthy run.
  const { reconciler, workStore, taskStore } = harness(
    [makeWork({ updatedAt: MOMENTS_AGO })],
    [makeTask("task-running", "running")],
  );

  const result = await reconciler.reconcile();

  assert.equal(result.recoveredWork.length, 0);
  assert.equal(workStore.get("work-1" as WorkId)!.status, "executing");
  assert.equal(taskStore.get("task-running" as TaskId)!.status, "running");
});

test("ignores work that is not mid-run", async () => {
  const { reconciler } = harness(
    [
      makeWork({ id: "work-done" as WorkId, status: "completed" }),
      makeWork({ id: "work-queued" as WorkId, status: "queued" }),
      makeWork({ id: "work-waiting" as WorkId, status: "waiting_approval" }),
    ],
    [],
  );

  const result = await reconciler.reconcile();

  assert.equal(result.recoveredWork.length, 0);
});

test("recovers work stranded during planning", async () => {
  const { reconciler, workStore } = harness(
    [makeWork({ status: "planning" })],
    [],
  );

  const result = await reconciler.reconcile();

  assert.equal(result.recoveredWork.length, 1);
  assert.equal(workStore.get("work-1" as WorkId)!.status, "failed");
});

test("records the interruption as a work.failed event", async () => {
  const { reconciler, events } = harness(
    [makeWork()],
    [makeTask("task-running", "running")],
  );

  await reconciler.reconcile();
  const failure = events.find((event) => event.type === "work.failed");

  assert.ok(failure);
  assert.equal(failure.payload.stage, "execution");
  assert.equal(failure.payload.interruptedTaskCount, 1);
});
