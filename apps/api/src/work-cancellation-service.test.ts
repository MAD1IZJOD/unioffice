import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApprovalId,
  ApprovalRequest,
  Event,
  OrganizationId,
  Task,
  TaskId,
  Work,
  WorkId,
} from "@unioffice/core";

import { InMemoryExecutionJobRepository } from "@unioffice/database";

import { EventRecorder } from "./event-recorder.js";
import type { ApiServices } from "./server.js";
import { buildTestServer, type TestServices } from "./access/testing.js";
import { WorkCancellationError, WorkCancellationService } from "./work-cancellation-service.js";

/**
 * Cancelling a mission over the production service, a real in-memory queue
 * and in-memory rows. What matters is what it refuses: anything that would
 * race a worker or the planner.
 */

const organizationId = "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId;
const actorId = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";
const now = new Date();
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

function setup() {
  const works = new Map<WorkId, Work>();
  const tasks = new Map<TaskId, Task>();
  const approvals = new Map<ApprovalId, ApprovalRequest>();
  const events: Event[] = [];
  const jobs = new InMemoryExecutionJobRepository();

  const service = new WorkCancellationService(
    {
      async findById(id) { return works.get(id) ?? null; },
      async update(work) { works.set(work.id, work); return work; },
    },
    {
      async findByWork(workId) { return [...tasks.values()].filter((task) => task.workId === workId); },
      async update(task) { tasks.set(task.id, task); return task; },
    },
    jobs,
    {
      async findByWork(workId) { return [...approvals.values()].filter((approval) => approval.workId === workId); },
      async resolvePending(approval) {
        const current = approvals.get(approval.id);
        if (!current || current.status !== "pending") return null;
        approvals.set(approval.id, approval);
        return approval;
      },
    },
    new EventRecorder({
      async create(event) { events.push(event); return event; },
      async findByWork() { return events; },
      async findByOrganization() { return events; },
    }),
    { now: () => now },
  );

  function mission(overrides: Partial<Work> = {}): Work {
    const work: Work = {
      id: crypto.randomUUID() as WorkId,
      organizationId,
      requesterId: actorId as Work["requesterId"],
      objective: "A test mission",
      status: "queued",
      priority: "normal",
      createdAt: ago(600),
      updatedAt: ago(600),
      metadata: {},
      ...overrides,
    };
    works.set(work.id, work);
    return work;
  }

  function step(work: Work, status: Task["status"]): Task {
    const task: Task = {
      id: crypto.randomUUID() as TaskId,
      workId: work.id,
      title: `Step ${status}`,
      description: "",
      status,
      dependsOn: [],
      createdAt: work.createdAt,
      updatedAt: work.updatedAt,
      metadata: {},
    };
    tasks.set(task.id, task);
    return task;
  }

  return { service, works, tasks, approvals, events, jobs, mission, step };
}

test("a queued mission is cancelled with its job, its unfinished steps and a record of who and why", async () => {
  const f = setup();
  const work = f.mission();
  const done = f.step(work, "completed");
  const pending = f.step(work, "pending");
  const job = await f.jobs.enqueue({ organizationId, workId: work.id, reason: "requested" });

  const result = await f.service.cancelWork(work.id, { actorId, reason: "A test mission left behind." });

  assert.equal(result.work.status, "cancelled");
  assert.equal(result.cancelledJob, true);
  assert.equal(result.cancelledTaskCount, 1);
  assert.equal((await f.jobs.findById(job.id))?.status, "cancelled");
  assert.equal(f.tasks.get(done.id)?.status, "completed", "finished work is kept");
  assert.equal(f.tasks.get(pending.id)?.status, "cancelled");
  assert.deepEqual(result.work.metadata.cancellation, {
    at: now.toISOString(),
    by: actorId,
    reason: "A test mission left behind.",
    previousStatus: "queued",
  });

  const [event] = f.events;
  assert.equal(event?.type, "work.cancelled");
  assert.equal(event?.actorType, "user");
  assert.equal(event?.actorId, actorId);
});

test("cancelling a mission waiting for a decision closes the decision rather than leaving it pending", async () => {
  const f = setup();
  const work = f.mission({ status: "waiting_approval", metadata: { waitingTaskId: "t" } });
  const waiting = f.step(work, "waiting");
  const approval: ApprovalRequest = {
    id: crypto.randomUUID() as ApprovalId,
    organizationId,
    workId: work.id,
    taskId: waiting.id,
    action: "Send the announcement",
    resource: `task:${waiting.id}`,
    reason: "Contacts customers.",
    status: "pending",
    createdAt: ago(60),
    metadata: {},
  };
  f.approvals.set(approval.id, approval);

  const result = await f.service.cancelWork(work.id, { actorId });

  assert.equal(result.closedApprovalCount, 1);
  assert.equal(f.approvals.get(approval.id)?.status, "cancelled");
  assert.equal(f.approvals.get(approval.id)?.resolvedBy, actorId);
  assert.equal(f.tasks.get(waiting.id)?.status, "cancelled");
  assert.equal(result.work.metadata.waitingTaskId, undefined);
  assert.equal((result.work.metadata.cancellation as { reason: string }).reason, "Cancelled by a person.");
});

test("a failed mission can be cancelled so it stops asking to be retried", async () => {
  const f = setup();
  const work = f.mission({ status: "failed", completedAt: ago(30), metadata: { executionError: "Task failed: X" } });

  const result = await f.service.cancelWork(work.id, { actorId });

  assert.equal(result.work.status, "cancelled");
  assert.equal(result.cancelledJob, false);
});

test("a mission a worker is running is refused, and nothing about it changes", async () => {
  const f = setup();
  const work = f.mission({ status: "executing" });
  const running = f.step(work, "running");
  await f.jobs.enqueue({ organizationId, workId: work.id, reason: "requested" });
  await f.jobs.claimNext({ workerId: "worker-a", leaseMs: 60_000 });

  await assert.rejects(f.service.cancelWork(work.id, { actorId }), /A worker is running this mission right now/);

  assert.equal(f.works.get(work.id)?.status, "executing");
  assert.equal(f.tasks.get(running.id)?.status, "running");
  assert.equal(f.events.length, 0);
});

test("a worker that claims the job mid-cancellation wins, and the mission is left running", async () => {
  const f = setup();
  const work = f.mission();
  await f.jobs.enqueue({ organizationId, workId: work.id, reason: "requested" });

  // The claim lands between the service reading the queued job and cancelling it.
  const cancel = f.jobs.cancel.bind(f.jobs);
  f.jobs.cancel = async (...args) => {
    await f.jobs.claimNext({ workerId: "worker-a", leaseMs: 60_000 });
    return cancel(...args);
  };

  await assert.rejects(f.service.cancelWork(work.id, { actorId }), /A worker picked this mission up just now/);
  assert.equal(f.works.get(work.id)?.status, "queued");
  assert.equal(f.events.length, 0);
});

test("a plan being written right now is refused; one abandoned mid-planning can be cancelled", async () => {
  const f = setup();
  const writing = f.mission({ status: "planning", updatedAt: ago(2) });
  const abandoned = f.mission({ status: "planning", updatedAt: ago(90) });

  await assert.rejects(f.service.cancelWork(writing.id, { actorId }), /The plan is being written right now/);
  assert.equal((await f.service.cancelWork(abandoned.id, { actorId })).work.status, "cancelled");
});

test("a finished or already cancelled mission cannot be cancelled", async () => {
  const f = setup();
  const finished = f.mission({ status: "completed" });
  const cancelled = f.mission({ status: "cancelled" });

  await assert.rejects(f.service.cancelWork(finished.id, { actorId }), WorkCancellationError);
  await assert.rejects(f.service.cancelWork(cancelled.id, { actorId }), /already cancelled/);
});

test("the route records the server's requester, reads only the reason, and maps a refusal to 409", async () => {
  const f = setup();
  const queued = f.mission();
  const finished = f.mission({ status: "completed" });

  const app = buildTestServer({
    workCancellationService: f.service,
    workQueryService: { assertWorkInOrganization: async () => undefined },
    developmentOrganizationId: organizationId,
    corsOrigins: [],
    healthCheck: async () => ({}),
  } as unknown as ApiServices);

  const response = await app.inject({
    method: "POST",
    url: `/work/${queued.id}/cancel?organizationId=${organizationId}`,
    payload: { reason: "Old test data.", actorId: "99999999-9999-4999-8999-999999999999", status: "completed" },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().work.status, "cancelled");
  assert.equal((f.works.get(queued.id)?.metadata.cancellation as { by: string; reason: string }).by, actorId);
  assert.equal((f.works.get(queued.id)?.metadata.cancellation as { reason: string }).reason, "Old test data.");

  const refused = await app.inject({
    method: "POST",
    url: `/work/${finished.id}/cancel?organizationId=${organizationId}`,
    payload: {},
  });

  assert.equal(refused.statusCode, 409);
  assert.match(refused.json().error.message, /already completed/);
});
