import type {
  ExecutionJob,
  ExecutionJobId,
  ExecutionJobReason,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

export interface EnqueueExecutionJobInput {
  organizationId: OrganizationId;
  workId: WorkId;
  reason: ExecutionJobReason;
  maxAttempts?: number;
  runAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface ClaimExecutionJobInput {
  /** Identifies the claiming worker, recorded on the row for diagnosis. */
  workerId: string;
  /** How long the claim is good for before another worker may take over. */
  leaseMs: number;
  now?: Date;
}

/** The job ID and claim generation returned by claimNext. */
export type ExecutionJobAttempt = Pick<ExecutionJob, "id" | "attempts">;

export interface ExecutionJobRepository {
  /**
   * Puts work on the queue, or returns the job already queued or running for
   * it. Enqueuing is idempotent per work item by design - the same objective
   * must never be executed twice because a caller retried a request or two
   * paths both asked for it.
   */
  enqueue(input: EnqueueExecutionJobInput): Promise<ExecutionJob>;

  findById(id: ExecutionJobId): Promise<ExecutionJob | null>;

  /** The queued or running job for a work item, if one exists. */
  findActiveByWork(workId: WorkId): Promise<ExecutionJob | null>;

  /**
   * Atomically takes ownership of one runnable job, or returns null when
   * there is nothing to do. Two workers calling this concurrently must never
   * both receive the same job.
   */
  claimNext(input: ClaimExecutionJobInput): Promise<ExecutionJob | null>;

  /** Extends the lease only while this worker still holds the same attempt. */
  heartbeat(
    attempt: ExecutionJobAttempt,
    workerId: string,
    leaseMs: number,
    now?: Date,
  ): Promise<ExecutionJob | null>;

  /** Settlement methods return null if the attempt no longer owns the job. */
  complete(attempt: ExecutionJobAttempt, now?: Date): Promise<ExecutionJob | null>;

  /** Ends the job permanently; the work keeps its own failure state. */
  fail(
    attempt: ExecutionJobAttempt,
    error: string,
    now?: Date,
  ): Promise<ExecutionJob | null>;

  /** Puts a recoverable failure back on the queue, optionally after a delay. */
  requeue(
    attempt: ExecutionJobAttempt,
    error: string,
    runAt?: Date,
    now?: Date,
  ): Promise<ExecutionJob | null>;

  /**
   * Takes a job off the queue before any worker has claimed it. Returns null
   * when the job is no longer queued - already claimed, finished or gone - so
   * a cancellation can never pull a job out from under a worker running it.
   */
  cancel(
    id: ExecutionJobId,
    reason: string,
    now?: Date,
  ): Promise<ExecutionJob | null>;

  /**
   * Finds jobs whose lease expired because the worker holding them died, and
   * returns them to the queue so another worker can finish the job. Only jobs
   * that have exhausted their attempts are failed outright.
   */
  recoverExpiredLeases(now?: Date): Promise<{
    requeued: ExecutionJob[];
    failed: ExecutionJob[];
  }>;

  findByOrganization(
    organizationId: OrganizationId,
    limit?: number,
  ): Promise<ExecutionJob[]>;
}
