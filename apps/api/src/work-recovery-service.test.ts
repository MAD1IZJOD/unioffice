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
import { WorkRecoveryService } from "./work-recovery-service.js";

const organizationId = "organization-1" as OrganizationId;
const workId = "work-1" as WorkId;

function makeWork(overrides: Partial<Work> = {}): Work {
  const now = new Date();

  return {
    id: workId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: "Test objective.",
    status: "failed",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    metadata: { executionError: "Task failed: Analyse costs" },
    ...overrides,
  };
}

function makeTask(id: string, status: Task["status"]): Task {
  const now = new Date();

  return {
    id: id as TaskId,
    workId,
    title: `Task ${id}`,
    description: "Task description.",
    status,
    dependsOn: [],
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
    result: status === "completed" ? "A durable result." : undefined,
    metadata: { execution: { status } },
  };
}

function harness(work: Work, tasks: Task[]) {
  const workStore = new Map<WorkId, Work>([[work.id, work]]);
  const taskStore = new Map<TaskId, Task>(
    tasks.map((task) => [task.id, task]),
  );
  const events: Event[] = [];

  const workRepository: WorkRepository = {
    async create(value) { return value; },
    async findById(id) { return workStore.get(id) ?? null; },
    async findByOrganization() { return [...workStore.values()]; },
    async findByWorkspace(_organizationId, workspaceId) {
      return [...workStore.values()].filter(
        (value) => value.workspaceId === workspaceId,
      );
    },
    async findByStatuses(statuses) {
      return [...workStore.values()].filter((work) => statuses.includes(work.status));
    },
    async update(value) { workStore.set(value.id, value); return value; },
    async delete() {},
  };

  const taskRepository: TaskRepository = {
    async create(value) { taskStore.set(value.id, value); return value; },
    async findById(id) { return taskStore.get(id) ?? null; },
    async findByAgent(agentId) {
      return [...taskStore.values()].filter(
        (value) => value.assignedAgentId === agentId,
      );
    },
    async findByWork() { return [...taskStore.values()]; },
    async findByWorkIds() { return [...taskStore.values()]; },
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
    service: new WorkRecoveryService(
      workRepository,
      taskRepository,
      new EventRecorder(eventRepository),
    ),
    taskStore,
    events,
  };
}

test("retry keeps completed tasks and resets only the ones that did not finish", async () => {
  const { service, taskStore } = harness(makeWork(), [
    makeTask("task-done", "completed"),
    makeTask("task-broken", "failed"),
    makeTask("task-never-ran", "pending"),
  ]);

  const result = await service.retryWork(workId);

  assert.equal(result.mode, "resume");
  assert.equal(result.work.status, "queued");
  assert.equal(taskStore.get("task-done" as TaskId)!.status, "completed");
  assert.equal(taskStore.get("task-done" as TaskId)!.result, "A durable result.");
  assert.equal(taskStore.get("task-broken" as TaskId)!.status, "pending");
  assert.equal(taskStore.get("task-never-ran" as TaskId)!.status, "pending");
});

test("retry clears the stale failure state from the reset task and work", async () => {
  const { service, taskStore } = harness(makeWork(), [
    makeTask("task-broken", "failed"),
  ]);

  const result = await service.retryWork(workId);
  const resetTask = taskStore.get("task-broken" as TaskId)!;

  assert.equal(resetTask.metadata.execution, undefined);
  assert.equal(resetTask.completedAt, undefined);
  assert.equal(result.work.metadata.executionError, undefined);
  assert.equal(result.work.completedAt, undefined);
  // The original failure is preserved for operators rather than erased.
  assert.match(
    JSON.stringify(result.work.metadata.retry),
    /Task failed: Analyse costs/,
  );
});

test("retry reports replan when planning failed before producing any task", async () => {
  const { service } = harness(
    makeWork({ metadata: { planningError: "Planner returned no tasks." } }),
    [],
  );

  const result = await service.retryWork(workId);

  assert.equal(result.mode, "replan");
  assert.equal(result.work.status, "queued");
  assert.equal(result.work.metadata.planningError, undefined);
});

test("retry records a work.retried event describing what was reset", async () => {
  const { service, events } = harness(makeWork(), [
    makeTask("task-done", "completed"),
    makeTask("task-broken", "failed"),
  ]);

  await service.retryWork(workId);
  const retried = events.find((event) => event.type === "work.retried");

  assert.ok(retried);
  assert.equal(retried.payload.resetTaskCount, 1);
  assert.equal(retried.payload.preservedTaskCount, 1);
});

test("retry refuses work that is not in a failed state", async () => {
  const { service } = harness(makeWork({ status: "executing" }), []);

  await assert.rejects(
    () => service.retryWork(workId),
    /Only failed work can be retried; this work is executing\./,
  );
});
