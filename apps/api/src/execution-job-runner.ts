import type { ExecutionJob } from "@unioffice/core";

import type {
  ExecutionJobRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

import type { WorkExecutionService } from "./work-execution-service.js";

export interface RunJobOutcome {
  job: ExecutionJob;
  outcome: "completed" | "failed" | "requeued";
  error?: string;
}

export interface ExecutionJobRunnerOptions {
  /** Delay before a requeued job becomes eligible again. */
  retryBackoffMs?: number;
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

  constructor(
    private readonly workExecutionService: WorkExecutionService,
    private readonly executionJobRepository: ExecutionJobRepository,
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRecorder: EventRecorder,
    options: ExecutionJobRunnerOptions = {},
  ) {
    this.retryBackoffMs = options.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
  }

  async run(job: ExecutionJob): Promise<RunJobOutcome> {
    try {
      await this.reclaimOrphanedTasks(job);
      await this.workExecutionService.executeWork(job.workId);

      const completed = await this.executionJobRepository.complete(job.id);

      return { job: completed ?? job, outcome: "completed" };
    } catch (error) {
      return this.handleFailure(job, errorMessage(error));
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
   * Any running task found here is an orphan, whichever attempt or job left
   * it behind: holding this job means no other worker can be executing this
   * work, because the queue allows one active job per work item and one
   * worker per job. So if a task says running, nothing is running it.
   */
  private async reclaimOrphanedTasks(job: ExecutionJob): Promise<void> {
    const tasks = await this.taskRepository.findByWork(job.workId);
    const orphaned = tasks.filter((task) => task.status === "running");

    for (const task of orphaned) {
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
  ): Promise<RunJobOutcome> {
    const attemptsRemain = job.attempts < job.maxAttempts;

    if (attemptsRemain) {
      const runAt = new Date(Date.now() + this.retryBackoffMs);
      const requeued = await this.executionJobRepository.requeue(
        job.id,
        error,
        runAt,
      );

      return { job: requeued ?? job, outcome: "requeued", error };
    }

    const failed = await this.executionJobRepository.fail(job.id, error);
    await this.recordWorkFailure(job, error);

    return { job: failed ?? job, outcome: "failed", error };
  }

  /**
   * Only once the queue has given up does the work itself get marked failed.
   * Doing it on the first error would make a transient outage look like a
   * failed objective while the job was still going to be retried.
   */
  private async recordWorkFailure(
    job: ExecutionJob,
    error: string,
  ): Promise<void> {
    try {
      const work = await this.workRepository.findById(job.workId);

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
          executionError: error,
        },
      });

      await this.eventRecorder.record({
        organizationId: failedWork.organizationId,
        workId: failedWork.id,
        type: "work.failed",
        payload: {
          stage: "execution",
          reason: error,
          jobId: job.id,
          attempts: job.attempts,
        },
      });
    } catch {
      // The runner must never throw: the job is already settled, and the
      // worker has to stay alive for the next one.
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
