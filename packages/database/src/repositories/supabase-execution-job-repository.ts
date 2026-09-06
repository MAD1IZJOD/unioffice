import {
  createEntityId,
  type ExecutionJob,
  type ExecutionJobId,
  type ExecutionJobReason,
  type ExecutionJobStatus,
  type OrganizationId,
  type WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ClaimExecutionJobInput,
  EnqueueExecutionJobInput,
  ExecutionJobRepository,
} from "./execution-job-repository.js";

interface ExecutionJobRow {
  id: string;
  organization_id: string;
  work_id: string;
  status: ExecutionJobStatus;
  reason: ExecutionJobReason;
  attempts: number;
  max_attempts: number;
  run_at: string;
  lease_expires_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

/** Postgres unique-violation, raised by the one-active-job-per-work index. */
const UNIQUE_VIOLATION = "23505";

/** How many runnable rows to consider before giving up on a claim attempt. */
const CLAIM_CANDIDATE_LIMIT = 5;

function fromRow(row: ExecutionJobRow): ExecutionJob {
  return {
    id: row.id as ExecutionJobId,
    organizationId: row.organization_id as OrganizationId,
    workId: row.work_id as WorkId,
    status: row.status,
    reason: row.reason,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: new Date(row.run_at),
    leaseExpiresAt: row.lease_expires_at
      ? new Date(row.lease_expires_at)
      : undefined,
    claimedBy: row.claimed_by ?? undefined,
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
    lastError: row.last_error ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    metadata: row.metadata ?? {},
  };
}

export class SupabaseExecutionJobRepository
  implements ExecutionJobRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async enqueue(input: EnqueueExecutionJobInput): Promise<ExecutionJob> {
    const now = new Date();
    const runAt = input.runAt ?? now;

    const { data, error } = await this.client
      .from("execution_jobs")
      .insert({
        id: createEntityId<"ExecutionJobId">(),
        organization_id: input.organizationId,
        work_id: input.workId,
        status: "queued",
        reason: input.reason,
        attempts: 0,
        max_attempts: input.maxAttempts ?? 3,
        run_at: runAt.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        metadata: input.metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      // The partial unique index rejected a second active job for this work.
      // That is the duplicate guard doing its job, not a fault: return the
      // job that already owns this work so enqueuing stays idempotent.
      if (error.code === UNIQUE_VIOLATION) {
        const existing = await this.findActiveByWork(input.workId);

        if (existing) {
          return existing;
        }
      }

      throw new Error(`Failed to enqueue execution job: ${error.message}`);
    }

    return fromRow(data as ExecutionJobRow);
  }

  async findById(id: ExecutionJobId): Promise<ExecutionJob | null> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to find execution job: ${error.message}`);
    }

    return data ? fromRow(data as ExecutionJobRow) : null;
  }

  async findActiveByWork(workId: WorkId): Promise<ExecutionJob | null> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .select("*")
      .eq("work_id", workId)
      .in("status", ["queued", "running"])
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to find the active execution job: ${error.message}`,
      );
    }

    return data ? fromRow(data as ExecutionJobRow) : null;
  }

  /**
   * Claims one job with a compare-and-swap.
   *
   * The update matches on the status and attempt count observed a moment ago,
   * so of two workers racing for the same row exactly one update finds a
   * matching row and the other gets nothing back. The loser simply moves on
   * to the next candidate rather than failing.
   */
  async claimNext(
    input: ClaimExecutionJobInput,
  ): Promise<ExecutionJob | null> {
    const now = input.now ?? new Date();

    const { data, error } = await this.client
      .from("execution_jobs")
      .select("*")
      .eq("status", "queued")
      .lte("run_at", now.toISOString())
      .order("run_at", { ascending: true })
      .limit(CLAIM_CANDIDATE_LIMIT);

    if (error) {
      throw new Error(
        `Failed to look for a runnable execution job: ${error.message}`,
      );
    }

    for (const row of (data as ExecutionJobRow[] | null) ?? []) {
      const candidate = fromRow(row);
      const claimed = await this.tryClaim(candidate, input, now);

      if (claimed) {
        return claimed;
      }
    }

    return null;
  }

  private async tryClaim(
    candidate: ExecutionJob,
    input: ClaimExecutionJobInput,
    now: Date,
  ): Promise<ExecutionJob | null> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .update({
        status: "running",
        attempts: candidate.attempts + 1,
        claimed_by: input.workerId,
        claimed_at: now.toISOString(),
        lease_expires_at: new Date(
          now.getTime() + input.leaseMs,
        ).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "queued")
      .eq("attempts", candidate.attempts)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to claim execution job: ${error.message}`);
    }

    return data ? fromRow(data as ExecutionJobRow) : null;
  }

  async heartbeat(
    id: ExecutionJobId,
    workerId: string,
    leaseMs: number,
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .update({
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", id)
      .eq("status", "running")
      // Only the holder may extend the lease; a worker whose job was
      // recovered from under it must not be able to reclaim it by heartbeat.
      .eq("claimed_by", workerId)
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to extend the job lease: ${error.message}`);
    }

    return data ? fromRow(data as ExecutionJobRow) : null;
  }

  async complete(
    id: ExecutionJobId,
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    return this.settle(id, {
      status: "completed",
      completed_at: now.toISOString(),
      lease_expires_at: null,
      last_error: null,
      updated_at: now.toISOString(),
    });
  }

  async fail(
    id: ExecutionJobId,
    error: string,
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    return this.settle(id, {
      status: "failed",
      completed_at: now.toISOString(),
      lease_expires_at: null,
      last_error: error,
      updated_at: now.toISOString(),
    });
  }

  async requeue(
    id: ExecutionJobId,
    error: string,
    runAt = new Date(),
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    return this.settle(id, {
      status: "queued",
      run_at: runAt.toISOString(),
      lease_expires_at: null,
      claimed_by: null,
      claimed_at: null,
      last_error: error,
      updated_at: now.toISOString(),
    });
  }

  /** Transitions a job out of running; a job already settled is left alone. */
  private async settle(
    id: ExecutionJobId,
    patch: Record<string, unknown>,
  ): Promise<ExecutionJob | null> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .update(patch)
      .eq("id", id)
      .eq("status", "running")
      .select()
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to settle execution job: ${error.message}`);
    }

    return data ? fromRow(data as ExecutionJobRow) : null;
  }

  async recoverExpiredLeases(now = new Date()): Promise<{
    requeued: ExecutionJob[];
    failed: ExecutionJob[];
  }> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .select("*")
      .eq("status", "running")
      .lt("lease_expires_at", now.toISOString());

    if (error) {
      throw new Error(
        `Failed to look for expired job leases: ${error.message}`,
      );
    }

    const requeued: ExecutionJob[] = [];
    const failed: ExecutionJob[] = [];

    for (const row of (data as ExecutionJobRow[] | null) ?? []) {
      const job = fromRow(row);
      const reason =
        `The worker holding this job stopped responding (lease expired at ${
          job.leaseExpiresAt?.toISOString() ?? "unknown"
        }).`;

      // Abandoned work is put back on the queue rather than failed - the
      // point of recovery is that another worker finishes the job. Only a
      // job that has burned through its attempts is given up on.
      if (job.attempts < job.maxAttempts) {
        const recovered = await this.requeue(job.id, reason, now, now);
        if (recovered) requeued.push(recovered);
        continue;
      }

      const abandoned = await this.fail(
        job.id,
        `${reason} No attempts remain.`,
        now,
      );
      if (abandoned) failed.push(abandoned);
    }

    return { requeued, failed };
  }

  async findByOrganization(
    organizationId: OrganizationId,
    limit = 50,
  ): Promise<ExecutionJob[]> {
    const { data, error } = await this.client
      .from("execution_jobs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(
        `Failed to find organization execution jobs: ${error.message}`,
      );
    }

    return ((data as ExecutionJobRow[] | null) ?? []).map(fromRow);
  }
}
