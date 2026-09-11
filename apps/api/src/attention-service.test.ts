import assert from "node:assert/strict";
import test from "node:test";

import type {
  ApprovalId,
  ApprovalRequest,
  ExecutionJob,
  ExecutionJobId,
  OrganizationId,
  Work,
  WorkId,
} from "@unioffice/core";

import { AttentionService } from "./attention-service.js";

const organizationId = "org-1" as OrganizationId;
const now = new Date("2026-01-01T12:00:00.000Z");

function work(id: string, overrides: Partial<Work> = {}): Work {
  return {
    id: id as WorkId,
    organizationId,
    requesterId: "user-1" as Work["requesterId"],
    objective: `Objective ${id}`,
    status: "completed",
    priority: "normal",
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function approval(
  id: string,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    id: id as ApprovalId,
    organizationId,
    workId: "w1" as WorkId,
    taskId: "t1" as ApprovalRequest["taskId"],
    action: "Send the launch email",
    resource: "task:t1",
    reason: "This would contact customers directly.",
    status: "pending",
    createdAt: now,
    metadata: {},
    ...overrides,
  };
}

function job(id: string, overrides: Partial<ExecutionJob> = {}): ExecutionJob {
  return {
    id: id as ExecutionJobId,
    organizationId,
    workId: "w1" as WorkId,
    status: "queued",
    reason: "requested",
    attempts: 0,
    maxAttempts: 3,
    runAt: now,
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function buildService(fixture: {
  approvals?: ApprovalRequest[];
  work?: Work[];
  jobs?: ExecutionJob[];
}) {
  return new AttentionService(
    {
      findPendingByOrganization: async () => fixture.approvals ?? [],
    } as never,
    { findByOrganization: async () => fixture.work ?? [] } as never,
    { findByOrganization: async () => fixture.jobs ?? [] } as never,
  );
}

test("a company with nothing wrong has an empty queue, and says so cleanly", async () => {
  const service = buildService({ work: [work("w1")] });

  const queue = await service.getQueue(organizationId);

  assert.deepEqual(queue.items, []);
  assert.equal(queue.actionCount, 0);
  assert.equal(queue.watchCount, 0);
  assert.equal(queue.total, 0);
});

test("a pending approval is an action, and names the mission it stopped", async () => {
  const service = buildService({
    approvals: [approval("ap1")],
    work: [work("w1", { objective: "Prepare the launch", status: "waiting_approval" })],
  });

  const queue = await service.getQueue(organizationId);

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0]?.kind, "decision");
  assert.equal(queue.items[0]?.severity, "action");
  assert.equal(queue.items[0]?.objective, "Prepare the launch");
  assert.equal(queue.actionCount, 1);
});

test("an interrupted run is not filed as a failure", async () => {
  const service = buildService({
    work: [
      work("w1", {
        status: "failed",
        metadata: { interrupted: true },
      }),
    ],
  });

  const queue = await service.getQueue(organizationId);

  assert.equal(queue.items[0]?.kind, "interrupted");
  assert.match(queue.items[0]?.consequence ?? "", /Resuming picks up/);
});

test("a failure carries the reason the backend recorded, not the objective", async () => {
  const service = buildService({
    work: [
      work("w1", {
        status: "failed",
        objective: "Draft the brief",
        metadata: { executionError: "The model provider refused the request." },
      }),
    ],
  });

  const queue = await service.getQueue(organizationId);

  assert.equal(
    queue.items[0]?.detail,
    "The model provider refused the request.",
  );
  assert.equal(queue.items[0]?.objective, "Draft the brief");
});

test("a retrying job is information rather than something to do", async () => {
  const service = buildService({
    work: [work("w1", { status: "executing" })],
    jobs: [job("j1", { attempts: 1, lastError: "Ollama was unreachable." })],
  });

  const queue = await service.getQueue(organizationId);

  assert.equal(queue.items[0]?.kind, "recovering");
  assert.equal(queue.items[0]?.severity, "watch");
  assert.equal(queue.actionCount, 0);
  assert.equal(queue.watchCount, 1);
});

test("a job on its first attempt is not recovery and is not reported", async () => {
  const service = buildService({
    work: [work("w1", { status: "executing" })],
    jobs: [job("j1")],
  });

  const queue = await service.getQueue(organizationId);

  assert.deepEqual(queue.items, []);
});

test("a running job is not reported as recovering, whatever it has been through", async () => {
  const service = buildService({
    work: [work("w1", { status: "executing" })],
    jobs: [job("j1", { status: "running", attempts: 2 })],
  });

  const queue = await service.getQueue(organizationId);

  assert.deepEqual(queue.items, []);
});

test("a queue entry whose mission no longer exists is dropped, not shown blank", async () => {
  const service = buildService({
    work: [],
    jobs: [job("j1", { attempts: 1, workId: "deleted" as WorkId })],
  });

  const queue = await service.getQueue(organizationId);

  assert.deepEqual(queue.items, []);
});

test("decisions outrank failures, and both outrank the system recovering itself", async () => {
  const service = buildService({
    approvals: [approval("ap1", { workId: "w3" as WorkId })],
    work: [
      work("w1", { status: "failed", metadata: { executionError: "boom" } }),
      work("w2", { status: "executing" }),
      work("w3", { status: "waiting_approval" }),
    ],
    jobs: [job("j1", { workId: "w2" as WorkId, attempts: 1 })],
  });

  const queue = await service.getQueue(organizationId);

  assert.deepEqual(
    queue.items.map((item) => item.kind),
    ["decision", "failure", "recovering"],
  );
});

test("within one kind the newest comes first", async () => {
  const service = buildService({
    work: [
      work("old", {
        status: "failed",
        updatedAt: new Date("2026-01-01T09:00:00.000Z"),
      }),
      work("new", {
        status: "failed",
        updatedAt: new Date("2026-01-01T11:00:00.000Z"),
      }),
    ],
  });

  const queue = await service.getQueue(organizationId);

  assert.deepEqual(
    queue.items.map((item) => item.workId),
    ["new", "old"],
  );
});

test("the returned list is capped but the count is honest about the rest", async () => {
  const service = buildService({
    work: Array.from({ length: 8 }, (_, index) =>
      work(`w${index}`, { status: "failed" }),
    ),
  });

  const queue = await service.getQueue(organizationId, { limit: 3 });

  assert.equal(queue.items.length, 3);
  assert.equal(queue.total, 8);
  assert.equal(queue.actionCount, 8);
});
