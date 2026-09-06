import assert from "node:assert/strict";
import test from "node:test";

import type { OrganizationId, WorkId } from "@unioffice/core";

import { InMemoryExecutionJobRepository } from "./in-memory-execution-job-repository.js";

const organizationId = "organization-1" as OrganizationId;
const workId = "work-1" as WorkId;
const otherWorkId = "work-2" as WorkId;

function repository() {
  return new InMemoryExecutionJobRepository();
}

function enqueue(
  jobs: InMemoryExecutionJobRepository,
  overrides: { workId?: WorkId; maxAttempts?: number; runAt?: Date } = {},
) {
  return jobs.enqueue({
    organizationId,
    workId: overrides.workId ?? workId,
    reason: "requested",
    maxAttempts: overrides.maxAttempts,
    runAt: overrides.runAt,
  });
}

test("enqueue puts work on the queue ready to run", async () => {
  const jobs = repository();
  const job = await enqueue(jobs);

  assert.equal(job.status, "queued");
  assert.equal(job.workId, workId);
  assert.equal(job.attempts, 0);
  assert.equal(job.reason, "requested");
});

test("enqueuing the same work twice returns the job that already owns it", async () => {
  // The duplicate-execution guard. A double-click, a retried request, or two
  // code paths both asking must not start the same objective twice.
  const jobs = repository();

  const first = await enqueue(jobs);
  const second = await enqueue(jobs);

  assert.equal(second.id, first.id);
  assert.equal(jobs.all().length, 1);
});

test("work can be queued again once its previous job has settled", async () => {
  const jobs = repository();
  const first = await enqueue(jobs);
  await jobs.claimNext({ workerId: "worker-a", leaseMs: 1000 });
  await jobs.complete(first.id);

  const second = await enqueue(jobs);

  assert.notEqual(second.id, first.id);
  assert.equal(second.status, "queued");
});

test("claiming takes ownership and counts the attempt", async () => {
  const jobs = repository();
  const queued = await enqueue(jobs);

  const claimed = await jobs.claimNext({
    workerId: "worker-a",
    leaseMs: 30_000,
  });

  assert.ok(claimed);
  assert.equal(claimed.id, queued.id);
  assert.equal(claimed.status, "running");
  assert.equal(claimed.claimedBy, "worker-a");
  assert.equal(claimed.attempts, 1);
  assert.ok(claimed.leaseExpiresAt);
});

test("a claimed job is not offered to the next worker", async () => {
  const jobs = repository();
  await enqueue(jobs);

  const first = await jobs.claimNext({ workerId: "worker-a", leaseMs: 30_000 });
  const second = await jobs.claimNext({ workerId: "worker-b", leaseMs: 30_000 });

  assert.ok(first);
  assert.equal(second, null);
});

test("two workers racing for one job produce exactly one winner", async () => {
  // Both workers read the same queued row before either writes. Only the
  // compare-and-swap decides the winner, which is the property the database
  // index and row lock provide in production.
  const jobs = repository();
  await enqueue(jobs);

  let released!: () => void;
  const bothHaveRead = new Promise<void>((resolve) => {
    released = resolve;
  });

  let readers = 0;
  jobs.onBeforeClaimWrite = async () => {
    readers += 1;
    if (readers === 2) released();
    if (readers < 2) await bothHaveRead;
  };

  const [a, b] = await Promise.all([
    jobs.claimNext({ workerId: "worker-a", leaseMs: 30_000 }),
    jobs.claimNext({ workerId: "worker-b", leaseMs: 30_000 }),
  ]);

  const winners = [a, b].filter(Boolean);
  assert.equal(winners.length, 1, "exactly one worker may claim a job");
  assert.equal(winners[0]!.attempts, 1);
});

test("a job scheduled for later is not claimable yet", async () => {
  const jobs = repository();
  const now = new Date("2026-09-06T12:00:00Z");
  await enqueue(jobs, { runAt: new Date(now.getTime() + 60_000) });

  const tooEarly = await jobs.claimNext({
    workerId: "worker-a",
    leaseMs: 1000,
    now,
  });
  const later = await jobs.claimNext({
    workerId: "worker-a",
    leaseMs: 1000,
    now: new Date(now.getTime() + 61_000),
  });

  assert.equal(tooEarly, null);
  assert.ok(later);
});

test("completing a job clears its lease", async () => {
  const jobs = repository();
  const queued = await enqueue(jobs);
  await jobs.claimNext({ workerId: "worker-a", leaseMs: 30_000 });

  const completed = await jobs.complete(queued.id);

  assert.ok(completed);
  assert.equal(completed.status, "completed");
  assert.equal(completed.leaseExpiresAt, undefined);
  assert.ok(completed.completedAt);
});

test("failing a job records why and ends it", async () => {
  const jobs = repository();
  const queued = await enqueue(jobs);
  await jobs.claimNext({ workerId: "worker-a", leaseMs: 30_000 });

  const failed = await jobs.fail(queued.id, "Ollama is unreachable.");

  assert.ok(failed);
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "Ollama is unreachable.");
});

test("requeueing returns a job to the queue for another attempt", async () => {
  const jobs = repository();
  const queued = await enqueue(jobs);
  await jobs.claimNext({ workerId: "worker-a", leaseMs: 30_000 });

  const requeued = await jobs.requeue(queued.id, "A transient failure.");

  assert.ok(requeued);
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.claimedBy, undefined);
  // The attempt already spent is kept, so retries stay bounded.
  assert.equal(requeued.attempts, 1);

  const reclaimed = await jobs.claimNext({
    workerId: "worker-b",
    leaseMs: 30_000,
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.attempts, 2);
});

test("settling a job that is not running changes nothing", async () => {
  const jobs = repository();
  const queued = await enqueue(jobs);

  assert.equal(await jobs.complete(queued.id), null);
  assert.equal((await jobs.findById(queued.id))!.status, "queued");
});

test("an expired lease is requeued so another worker can finish it", async () => {
  // Recovery must not throw the work away: the point is that someone else
  // picks it up.
  const jobs = repository();
  const now = new Date("2026-09-06T12:00:00Z");
  await enqueue(jobs, { runAt: now });
  const claimed = await jobs.claimNext({
    workerId: "dead-worker",
    leaseMs: 1000,
    now,
  });
  assert.ok(claimed, "the job must be claimed before its lease can expire");

  const later = new Date(now.getTime() + 5000);
  const recovered = await jobs.recoverExpiredLeases(later);

  assert.equal(recovered.requeued.length, 1);
  assert.equal(recovered.failed.length, 0);
  assert.equal(recovered.requeued[0]!.status, "queued");

  const reclaimed = await jobs.claimNext({
    workerId: "worker-b",
    leaseMs: 1000,
    now: later,
  });
  assert.ok(reclaimed);
  assert.equal(reclaimed.claimedBy, "worker-b");
});

test("a live lease is left alone", async () => {
  const jobs = repository();
  const now = new Date("2026-09-06T12:00:00Z");
  await enqueue(jobs, { runAt: now });
  const claimed = await jobs.claimNext({
    workerId: "worker-a",
    leaseMs: 60_000,
    now,
  });
  assert.ok(claimed, "a live lease can only be asserted on a claimed job");

  const recovered = await jobs.recoverExpiredLeases(
    new Date(now.getTime() + 5000),
  );

  assert.equal(recovered.requeued.length, 0);
  assert.equal(recovered.failed.length, 0);
});

test("a job that has burned through its attempts is failed rather than requeued forever", async () => {
  const jobs = repository();
  const now = new Date("2026-09-06T12:00:00Z");
  await enqueue(jobs, { maxAttempts: 1, runAt: now });
  const claimed = await jobs.claimNext({
    workerId: "dead-worker",
    leaseMs: 1000,
    now,
  });
  assert.ok(claimed);

  const recovered = await jobs.recoverExpiredLeases(
    new Date(now.getTime() + 5000),
  );

  assert.equal(recovered.requeued.length, 0);
  assert.equal(recovered.failed.length, 1);
  assert.match(String(recovered.failed[0]!.lastError), /No attempts remain/);
});

test("heartbeat extends the lease only for the worker holding it", async () => {
  const jobs = repository();
  const now = new Date("2026-09-06T12:00:00Z");
  const queued = await enqueue(jobs, { runAt: now });
  const claimed = await jobs.claimNext({
    workerId: "worker-a",
    leaseMs: 1000,
    now,
  });
  assert.ok(claimed);

  const stolen = await jobs.heartbeat(queued.id, "worker-b", 60_000, now);
  const extended = await jobs.heartbeat(queued.id, "worker-a", 60_000, now);

  assert.equal(stolen, null);
  assert.ok(extended);
  assert.equal(
    extended.leaseExpiresAt!.getTime(),
    now.getTime() + 60_000,
  );
});

test("jobs for different work items are independent", async () => {
  const jobs = repository();
  await enqueue(jobs);
  await enqueue(jobs, { workId: otherWorkId });

  const first = await jobs.claimNext({ workerId: "worker-a", leaseMs: 1000 });
  const second = await jobs.claimNext({ workerId: "worker-b", leaseMs: 1000 });

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.workId, second.workId);
});
