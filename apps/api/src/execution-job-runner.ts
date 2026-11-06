import type { ExecutionJob, Work } from "@unioffice/core";

import type {
  ExecutionJobRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

import type { WorkExecutionService } from "./work-execution-service.js";
import { runInExecutionAttempt } from "./execution-attempt.js";

export interface RunJobOutcome {
  job: ExecutionJob;
  outcome: "completed" | "failed" | "requeued";
  error?: string;
}

export interface ExecutionJobRunnerOptions {
  /** Delay before a requeued job becomes eligible again. */
  retryBackoffMs?: number;
  assertClaim?: () => Promise<void>;

  /**
   * Plans a mission. A scheduled run arrives unplanned - nobody held a
   * request open to plan it - so the worker plans it with the same service a
   * launch uses before executing it. Absent, a scheduled job is executed as
   * it stands.
   */
  planner?: {
    beginPlanning(workId: ExecutionJob["workId"]): Promise<boolean>;
    planWork(workId: ExecutionJob["workId"], signal?: AbortSignal): Promise<{ work: { status: string } }>;
  };
}

const DEFAULT_RETRY_BACKOFF_MS = 15_000;

/**
 * Executes one claimed job through the existing pipeline.
 *
 * This deliberately owns none of the business state. It calls the same
 * WorkExecutionService the API used to call in-process, so tasks, artifacts,
 * memories, approvals and events are written exactly as before. Its only job
 * is to translate the outcome into the queue's vocabulary: done, retry later,
 * or give up.
 */
export class ExecutionJobRunner {
  private readonly retryBackoffMs: number;
  private readonly planner?: ExecutionJobRunnerOptions["planner"];
  private readonly assertClaim?: ExecutionJobRunnerOptions["assertClaim"];

  constructor(
    private readonly workExecutionService: WorkExecutionService,
    private readonly executionJobRepository: ExecutionJobRepository,
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRecorder: EventRecorder,
    options: ExecutionJobRunnerOptions = {},
  ) {
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.planner = options.planner;
    this.assertClaim = options.assertClaim;
  }

  async run(job: ExecutionJob, controller = new AbortController()): Promise<RunJobOutcome | null> {
    return runInExecutionAttempt(job, controller, () => this.runAttempt(job, controller.signal));
  }

  private async runAttempt(job: ExecutionJob, signal: AbortSignal): Promise<RunJobOutcome | null> {
    try {
      signal.throwIfAborted();
      await this.assertClaim?.();
      signal.throwIfAborted();
      if (job.reason === "scheduled" && this.planner) {
        const planned = await this.planScheduledRun(job, signal);
        if (planned !== undefined) return planned;
      }

      await this.reclaimOrphanedTasks(job, signal);
      const execution = await this.workExecutionService.executeWork(job.workId, signal);
      signal.throwIfAborted();

      // WorkExecutionService records an objective-level failure as a normal
      // result so its caller can persist the terminal task and work states.
      // A completed queue job must not contradict that terminal mission.
      if (execution.work.status === "failed") {
        const error = workFailureMessage(execution.work);
        const failed = await this.executionJobRepository.fail(job, error);
        return failed && { job: failed, outcome: "failed", error };
      }

      const completed = await this.executionJobRepository.complete(job);

      return completed && { job: completed, outcome: "completed" };
    } catch (error) {
      if (signal.aborted) return null;
      return this.handleFailure(job, errorMessage(error), signal);
    }
  }

  /**
   * Plans a scheduled run that has not been planned yet.
   *
   * Returns an outcome when the job ends here, null when ownership was lost,
   * and undefined when the run should go on to execute in this same attempt.
   *
   * A run that was already planned (an approval put it back on the queue, or
   * this is a later attempt after planning finished) goes straight on.
   * Planning is not retried by the queue: a failed plan is recorded on the
   * run itself, the run ends as failed, and the schedule's next occurrence
   * tries afresh. A run found half-planned - a worker died while writing its
   * steps - is ended the same way rather than planned a second time on top of
   * the steps it already has.
   */
  private async planScheduledRun(job: ExecutionJob, signal: AbortSignal): Promise<RunJobOutcome | null | undefined> {
    const planner = this.planner!;
    const work = await this.workRepository.findById(job.workId);
    signal.throwIfAborted();

    if (!work) {
      const error = "The run's mission no longer exists.";
      const failed = await this.executionJobRepository.fail(job, error);
      return failed && { job: failed, outcome: "failed", error };
    }

    if (work.status !== "queued" && work.status !== "planning") return undefined;

    const tasks = await this.taskRepository.findByWork(job.workId);
    signal.throwIfAborted();

    if (tasks.length > 0) {
      if (work.status === "queued") return undefined;

      const reason = "Planning this run was interrupted part-way, so it was stopped rather than planned twice.";
      await this.recordWorkFailure(job, reason, signal, "planning");
      signal.throwIfAborted();
      const failed = await this.executionJobRepository.fail(job, reason);
      return failed && { job: failed, outcome: "failed", error: reason };
    }

    try {
      if (work.status === "queued") await planner.beginPlanning(job.workId);
      signal.throwIfAborted();
      const planned = await planner.planWork(job.workId, signal);
      signal.throwIfAborted();

      // Cancelled while the plan was being written: the cancellation stands
      // and nothing runs.
      if (planned.work.status !== "queued") {
        const completed = await this.executionJobRepository.complete(job);
        return completed && { job: completed, outcome: "completed" };
      }

      return undefined;
    } catch (error) {
      signal.throwIfAborted();
      // Planning records its own failure on the mission, where the run's
      // page and the schedule read it from.
      const message = errorMessage(error);
      const failed = await this.executionJobRepository.fail(job, message);
      return failed && { job: failed, outcome: "failed", error: message };
    }
  }

  /**
   * Frees tasks a previous attempt left mid-flight.
   *
   * A worker killed while executing leaves its task saying "running". Nothing
   * is running it, but the executor reads that as "another executor owns
   * this" and returns without doing anything - so the job would be marked
   * complete while the work sat unfinished forever. This was found by pulling
   * the plug on a worker mid-run.
   *
   * The new claim owns recovery of running tasks left by earlier attempts.
   */
  private async reclaimOrphanedTasks(job: ExecutionJob, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const tasks = await this.taskRepository.findByWork(job.workId);
    const orphaned = tasks.filter((task) => task.status === "running");

    for (const task of orphaned) {
      signal.throwIfAborted();
      const now = new Date();

      await this.taskRepository.update({
        ...task,
        status: "pending",
        startedAt: undefined,
        completedAt: undefined,
        updatedAt: now,
        metadata: {
          ...task.metadata,
          execution: undefined,
          reclaimed: {
            at: now.toISOString(),
            reason:
              "The worker executing this task stopped; the task was returned to the plan.",
            attempt: job.attempts,
          },
        },
      });

      signal.throwIfAborted();
      await this.eventRecorder.record({
        organizationId: job.organizationId,
        workId: job.workId,
        taskId: task.id,
        agentId: task.assignedAgentId,
        type: "task.ready",
        payload: {
          title: task.title,
          reclaimed: true,
        },
      });
    }
  }

  /**
   * A thrown error is usually environmental - the model provider being down,
   * the database refusing a write - rather than the objective being
   * impossible. Those deserve another attempt, so the job goes back on the
   * queue until its attempts run out.
   */
  private async handleFailure(
    job: ExecutionJob,
    error: string,
    signal: AbortSignal,
  ): Promise<RunJobOutcome | null> {
    const attemptsRemain = job.attempts < job.maxAttempts;

    if (attemptsRemain) {
      const runAt = new Date(Date.now() + this.retryBackoffMs);
      const requeued = await this.executionJobRepository.requeue(
        job,
        error,
        runAt,
      );

      return requeued && { job: requeued, outcome: "requeued", error };
    }

    await this.recordWorkFailure(job, error, signal);
    if (signal.aborted) return null;
    const failed = await this.executionJobRepository.fail(job, error);

    return failed && { job: failed, outcome: "failed", error };
  }

  /**
   * Only once the queue has given up does the work itself get marked failed.
   * Doing it on the first error would make a transient outage look like a
   * failed objective while the job was still going to be retried.
   */
  private async recordWorkFailure(
    job: ExecutionJob,
    error: string,
    signal: AbortSignal,
    stage: "execution" | "planning" = "execution",
  ): Promise<void> {
    try {
      const current = await this.executionJobRepository.findById(job.id);
      if (current?.status !== "running" || current.attempts !== job.attempts) return;
      signal.throwIfAborted();
      const work = await this.workRepository.findById(job.workId);
      signal.throwIfAborted();

      if (!work || work.status === "completed" || work.status === "failed") {
        return;
      }

      const failedAt = new Date();
      const failedWork = await this.workRepository.update({
        ...work,
        status: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        metadata: {
          ...work.metadata,
          ...(stage === "planning" ? { planningError: error } : { executionError: error }),
        },
      });

      signal.throwIfAborted();
      await this.eventRecorder.record({
        organizationId: failedWork.organizationId,
        workId: failedWork.id,
        type: "work.failed",
        payload: {
          stage,
          reason: error,
          jobId: job.id,
          attempts: job.attempts,
        },
      });
    } catch {
      // The queue can still record a terminal error if mission storage failed.
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function workFailureMessage(work: Work): string {
  const error = work.metadata.executionError;
  return typeof error === "string" && error.trim().length > 0
    ? error
    : "Work execution failed.";
}
