import type { Task, Work, WorkId } from "@unioffice/core";

import type { TaskRepository, WorkRepository } from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

import type { WorkExecutionService } from "./work-execution-service.js";

export interface StartExecutionResult {
  work: Work;
  tasks: Task[];
  /** False when an execution for this work was already running. */
  started: boolean;
}

/**
 * Runs work execution in the background instead of inside the request.
 *
 * A single objective takes minutes of local model time. Holding the HTTP
 * request open for all of it meant the caller saw one long spinner, learned
 * nothing until the end, and hit client-side timeouts on the way (Node's
 * undici gives up on response headers after five minutes). Execution already
 * writes every state change to the database, so the honest interface is to
 * start it and let the caller read the same live rows every other view reads.
 */
export class ExecutionScheduler {
  /** Guards against a double-click or a retry starting the same work twice. */
  private readonly inFlight = new Map<WorkId, Promise<void>>();

  constructor(
    private readonly workExecutionService: WorkExecutionService,
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async startExecution(workId: WorkId): Promise<StartExecutionResult> {
    const work = await this.requireWork(workId);

    if (this.inFlight.has(workId)) {
      return {
        work,
        tasks: await this.taskRepository.findByWork(workId),
        started: false,
      };
    }

    const run = this.workExecutionService
      .executeWork(workId)
      .then(() => undefined)
      .catch(async (error: unknown) => {
        // Nothing is awaiting this promise, so an escaping rejection would be
        // an unhandled rejection that kills the process. Record it against the
        // work instead, where the UI already surfaces failures.
        await this.recordFailure(workId, error);
      })
      .finally(() => {
        this.inFlight.delete(workId);
      });

    this.inFlight.set(workId, run);

    return {
      work,
      tasks: await this.taskRepository.findByWork(workId),
      started: true,
    };
  }

  /** True while this process is executing the work item. */
  isRunning(workId: WorkId): boolean {
    return this.inFlight.has(workId);
  }

  /**
   * Waits for an in-flight execution to settle. Exists for tests and for a
   * graceful shutdown; request handlers deliberately do not use it.
   */
  async waitFor(workId: WorkId): Promise<void> {
    await this.inFlight.get(workId);
  }

  private async recordFailure(
    workId: WorkId,
    error: unknown,
  ): Promise<void> {
    try {
      const work = await this.workRepository.findById(workId);
      if (!work) return;

      const failedAt = new Date();
      const failedWork = await this.workRepository.update({
        ...work,
        status: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        metadata: {
          ...work.metadata,
          executionError: errorMessage(error),
        },
      });

      await this.eventRecorder.record({
        organizationId: failedWork.organizationId,
        workId: failedWork.id,
        type: "work.failed",
        payload: {
          stage: "execution",
          reason: errorMessage(error),
        },
      });
    } catch {
      // The scheduler must never throw from a detached promise. If even the
      // failure projection cannot be written, the work simply stays in its
      // last persisted state rather than taking the process down.
    }
  }

  private async requireWork(workId: WorkId): Promise<Work> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    return work;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
