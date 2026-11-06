import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionJobId } from "@unioffice/core";
import { createClient } from "@supabase/supabase-js";

import { SupabaseExecutionJobRepository } from "./supabase-execution-job-repository.js";

const jobId = "0e7300de-d122-435b-b33e-239ab23908a5" as ExecutionJobId;
const expiredAt = "2026-11-06T06:00:00.123456+00:00";
const now = new Date("2026-11-06T06:01:00.000Z");

/** Runs the real repository and Supabase client over a one-row HTTP transport. */
function fixture(maxAttempts = 3) {
  const row: Record<string, unknown> = {
    id: jobId,
    organization_id: "organization",
    work_id: "work",
    status: "running",
    reason: "requested",
    attempts: 1,
    max_attempts: maxAttempts,
    run_at: "2026-11-06T05:58:00.000Z",
    claimed_by: "worker-a",
    claimed_at: "2026-11-06T05:59:00.000Z",
    lease_expires_at: expiredAt,
    created_at: "2026-11-06T05:58:00.000Z",
    updated_at: "2026-11-06T05:59:00.000Z",
    completed_at: null,
    last_error: null,
    metadata: {},
  };
  const updates: URLSearchParams[] = [];
  let afterRecoveryRead: (() => Promise<void>) | undefined;

  const client = createClient("http://fixture.invalid", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        assert.equal(url.pathname, "/rest/v1/execution_jobs");
        const query = url.searchParams;
        const matches = [...query].every(([column, filter]) => {
          if (["select", "order", "limit"].includes(column)) return true;
          const value = row[column];
          const operator = filter.slice(0, filter.indexOf("."));
          const operand = filter.slice(operator.length + 1);
          if (operator === "eq") return String(value) === operand;
          assert.ok(operator === "lt" || operator === "lte", `Unexpected filter ${filter}`);
          if (typeof value !== "string") return false;
          const timestamp = Date.parse(value);
          const cutoff = Date.parse(operand);
          return operator === "lt" ? timestamp < cutoff : timestamp <= cutoff;
        });

        if (init?.method === "PATCH") {
          updates.push(query);
          assert.equal(typeof init.body, "string");
          if (matches) Object.assign(row, JSON.parse(init.body as string));
          return Response.json(matches ? [row] : []);
        }

        assert.equal(init?.method, "GET");
        const snapshot = matches ? [{ ...row }] : [];
        if (query.has("lease_expires_at") && afterRecoveryRead) {
          const renew = afterRecoveryRead;
          afterRecoveryRead = undefined;
          await renew();
        }
        return Response.json(snapshot);
      },
    },
  });

  return {
    repository: new SupabaseExecutionJobRepository(client),
    updates,
    afterRecoveryRead(renew: () => Promise<void>) { afterRecoveryRead = renew; },
  };
}

function assertAttemptGuard(query: URLSearchParams) {
  assert.equal(query.get("id"), `eq.${jobId}`);
  assert.equal(query.get("status"), "eq.running");
  assert.equal(query.get("attempts"), "eq.1");
}

function assertRecoveryGuard(query: URLSearchParams) {
  assertAttemptGuard(query);
  assert.deepEqual(query.getAll("lease_expires_at").sort(), [
    `eq.${expiredAt}`,
    `lt.${now.toISOString()}`,
  ]);
}

for (const maxAttempts of [1, 3]) {
  test(`a renewed lease survives recovery with an attempt limit of ${maxAttempts}`, async () => {
    const { repository, updates, afterRecoveryRead } = fixture(maxAttempts);
    const attempt = await repository.findById(jobId);
    assert.ok(attempt);
    afterRecoveryRead(async () => {
      const renewed = await repository.heartbeat(attempt, "worker-a", 60_000, now);
      assert.ok(renewed);
    });

    const result = await repository.recoverExpiredLeases(now);
    assert.deepEqual(result, { requeued: [], failed: [] });
    const job = await repository.findById(jobId);
    assert.equal(job?.status, "running");
    assert.equal(job.claimedBy, "worker-a");
    assert.equal(job.attempts, 1);
    assert.equal(job.leaseExpiresAt?.getTime(), now.getTime() + 60_000);
    assert.equal(updates.length, 2);
    assertRecoveryGuard(updates[1]!);
  });
}

test("an unchanged expired lease is recovered and can be claimed again", async () => {
  const { repository, updates } = fixture();
  const { requeued, failed } = await repository.recoverExpiredLeases(now);
  assert.equal(requeued.length, 1);
  assert.equal(failed.length, 0);
  assert.equal(requeued[0]?.claimedBy, undefined);
  assert.equal(requeued[0]?.attempts, 1);
  assertRecoveryGuard(updates[0]!);

  const replacement = await repository.claimNext({ workerId: "worker-b", leaseMs: 60_000, now });
  assert.equal(replacement?.id, jobId);
  assert.equal(replacement.attempts, 2);
  assert.equal(replacement.claimedBy, "worker-b");
});

test("an unchanged expired lease with no attempts left is failed", async () => {
  const { repository, updates } = fixture(1);
  const { requeued, failed } = await repository.recoverExpiredLeases(now);
  assert.equal(requeued.length, 0);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.status, "failed");
  assert.match(failed[0]?.lastError ?? "", /No attempts remain/);
  assertRecoveryGuard(updates[0]!);
});

test("an earlier attempt cannot settle or renew a replacement claim", async () => {
  const { repository, updates } = fixture();
  const stale = await repository.findById(jobId);
  assert.ok(stale);
  await repository.recoverExpiredLeases(now);
  // Reusing the worker ID makes the attempt number the deciding guard.
  const replacement = await repository.claimNext({ workerId: "worker-a", leaseMs: 60_000, now });
  assert.ok(replacement);
  assert.equal(replacement.attempts, 2);

  assert.equal(await repository.complete(stale, now), null);
  assert.equal(await repository.fail(stale, "late failure", now), null);
  assert.equal(await repository.requeue(stale, "late retry", now, now), null);
  assert.equal(await repository.heartbeat(stale, "worker-a", 120_000, now), null);
  assert.deepEqual(await repository.findById(jobId), replacement);
  assert.equal(updates.length, 6);
  for (const query of updates.slice(2)) assertAttemptGuard(query);

  assert.equal((await repository.complete(replacement, now))?.status, "completed");
});
