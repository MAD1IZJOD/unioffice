import type {
  ExecutionJobId,
  OrganizationId,
  WorkId,
} from "../types/ids.js";

export type ExecutionJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Why a job was put on the queue. The queue orchestrates execution only - the
 * work, task, artifact, memory and event rows remain the source of truth for
 * business state, and this never duplicates them.
 */
export type ExecutionJobReason =
  | "requested"
  | "approval_resumed"
  | "retry"
  | "recovered";

/**
 * A durable instruction to execute one work item.
 *
 * Execution used to live in the API process's memory, so a restart stranded
 * whatever was mid-flight. A job is a row: it survives the process that
 * created it, and any worker can pick it up.
 */
export interface ExecutionJob {
  id: ExecutionJobId;

  organizationId: OrganizationId;

  workId: WorkId;

  status: ExecutionJobStatus;

  reason: ExecutionJobReason;

  /** How many times a worker has claimed this job. */
  attempts: number;

  /** Once attempts reaches this, a failure stops being retryable. */
  maxAttempts: number;

  /** Not eligible to be claimed before this instant; used for retry backoff. */
  runAt: Date;

  /**
   * When the current claim goes stale. A worker that dies mid-run leaves this
   * in the past, which is how another worker knows the job is abandoned
   * rather than actively running.
   */
  leaseExpiresAt?: Date;

  /** Identifier of the worker holding the lease, for diagnosis. */
  claimedBy?: string;

  claimedAt?: Date;

  lastError?: string;

  createdAt: Date;

  updatedAt: Date;

  completedAt?: Date;

  metadata: Record<string, unknown>;
}

/** Statuses in which a job still owns the right to execute its work. */
export const ACTIVE_EXECUTION_JOB_STATUSES: ExecutionJobStatus[] = [
  "queued",
  "running",
];

export function isExecutionJobActive(job: ExecutionJob): boolean {
  return ACTIVE_EXECUTION_JOB_STATUSES.includes(job.status);
}
