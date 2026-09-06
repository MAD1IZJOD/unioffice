import {
  createEntityId,
  type ExecutionJob,
  type ExecutionJobId,
  type OrganizationId,
  type WorkId,
} from "@unioffice/core";

import type {
  ClaimExecutionJobInput,
  EnqueueExecutionJobInput,
  ExecutionJobRepository,
} from "./execution-job-repository.js";

/**
 * The execution queue kept in memory, implementing exactly the contract the
 * Supabase adapter implements.
 *
 * This exists so the queue's semantics - idempotent enqueue, compare-and-swap
 * claiming, lease recovery - can be tested deterministically and at speed. The
 * constraints the database enforces with a partial unique index and row locks
 * are enforced here in code, so a test that passes against this is asserting
 * the same behaviour the real adapter must provide.
 */
export class InMemoryExecutionJobRepository
  implements ExecutionJobRepository
{
  private readonly jobs = new Map<ExecutionJobId, ExecutionJob>();

  /** Test seam: lets a test observe the moment between read and write. */
  onBeforeClaimWrite?: (job: ExecutionJob) => void | Promise<void>;

  all(): ExecutionJob[] {
    return [...this.jobs.values()];
  }

  async enqueue(input: EnqueueExecutionJobInput): Promise<ExecutionJob> {
    // Mirrors the partial unique index on (work_id) where status is queued
    // or running: at most one active job per work item.
    const existing = await this.findActiveByWork(input.workId);

    if (existing) {
      return existing;
    }

    const now = new Date();
    const job: ExecutionJob = {
      id: createEntityId<"ExecutionJobId">() as ExecutionJobId,
      organizationId: input.organizationId,
      workId: input.workId,
      status: "queued",
      reason: input.reason,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      runAt: input.runAt ?? now,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata ?? {},
    };

    this.jobs.set(job.id, job);
    return job;
  }

  async findById(id: ExecutionJobId): Promise<ExecutionJob | null> {
    return this.jobs.get(id) ?? null;
  }

  async findActiveByWork(workId: WorkId): Promise<ExecutionJob | null> {
    return (
      this.all().find(
        (job) =>
          job.workId === workId &&
          (job.status === "queued" || job.status === "running"),
      ) ?? null
    );
  }

  async claimNext(
    input: ClaimExecutionJobInput,
  ): Promise<ExecutionJob | null> {
    const now = input.now ?? new Date();

    const candidates = this.all()
      .filter(
        (job) => job.status === "queued" && job.runAt.getTime() <= now.getTime(),
      )
      .sort((left, right) => left.runAt.getTime() - right.runAt.getTime());

    for (const candidate of candidates) {
      const observedAttempts = candidate.attempts;

      await this.onBeforeClaimWrite?.(candidate);

      // Compare-and-swap: re-read, and only take the job if nothing changed
      // since it was observed. This is what makes two racing workers resolve
      // to exactly one winner.
      const current = this.jobs.get(candidate.id);

      if (
        !current ||
        current.status !== "queued" ||
        current.attempts !== observedAttempts
      ) {
        continue;
      }

      const claimed: ExecutionJob = {
        ...current,
        status: "running",
        attempts: current.attempts + 1,
        claimedBy: input.workerId,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + input.leaseMs),
        updatedAt: now,
      };

      this.jobs.set(claimed.id, claimed);
      return claimed;
    }

    return null;
  }

  async heartbeat(
    id: ExecutionJobId,
    workerId: string,
    leaseMs: number,
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    const job = this.jobs.get(id);

    if (!job || job.status !== "running" || job.claimedBy !== workerId) {
      return null;
    }

    const extended: ExecutionJob = {
      ...job,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: now,
    };

    this.jobs.set(id, extended);
    return extended;
  }

  async complete(
    id: ExecutionJobId,
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    return this.settle(id, (job) => ({
      ...job,
      status: "completed",
      completedAt: now,
      leaseExpiresAt: undefined,
      lastError: undefined,
      updatedAt: now,
    }));
  }

  async fail(
    id: ExecutionJobId,
    error: string,
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    return this.settle(id, (job) => ({
      ...job,
      status: "failed",
      completedAt: now,
      leaseExpiresAt: undefined,
      lastError: error,
      updatedAt: now,
    }));
  }

  async requeue(
    id: ExecutionJobId,
    error: string,
    runAt = new Date(),
    now = new Date(),
  ): Promise<ExecutionJob | null> {
    return this.settle(id, (job) => ({
      ...job,
      status: "queued",
      runAt,
      leaseExpiresAt: undefined,
      claimedBy: undefined,
      claimedAt: undefined,
      lastError: error,
      updatedAt: now,
    }));
  }

  private settle(
    id: ExecutionJobId,
    transition: (job: ExecutionJob) => ExecutionJob,
  ): ExecutionJob | null {
    const job = this.jobs.get(id);

    if (!job || job.status !== "running") {
      return null;
    }

    const settled = transition(job);
    this.jobs.set(id, settled);
    return settled;
  }

  async recoverExpiredLeases(now = new Date()): Promise<{
    requeued: ExecutionJob[];
    failed: ExecutionJob[];
  }> {
    const requeued: ExecutionJob[] = [];
    const failed: ExecutionJob[] = [];

    for (const job of this.all()) {
      if (
        job.status !== "running" ||
        !job.leaseExpiresAt ||
        job.leaseExpiresAt.getTime() >= now.getTime()
      ) {
        continue;
      }

      const reason =
        `The worker holding this job stopped responding (lease expired at ${
          job.leaseExpiresAt.toISOString()
        }).`;

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
    return this.all()
      .filter((job) => job.organizationId === organizationId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }
}
