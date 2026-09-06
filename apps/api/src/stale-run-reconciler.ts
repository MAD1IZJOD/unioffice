import type { Task, Work } from "@unioffice/core";

import type { TaskRepository, WorkRepository } from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

export interface ReconcileResult {
  /** Work items whose interrupted run was closed out. */
  recoveredWork: Work[];
  /** Tasks that were left mid-flight by the previous process. */
  interruptedTaskCount: number;
}

/**
 * Closes out runs abandoned by a previous process.
 *
 * Execution runs in memory, so a restart mid-run leaves the work row saying
 * "executing" and a task saying "running" with nothing alive to finish them.
 * Before this, that work was stuck in a state no UI action could clear - it
 * looked permanently busy and the Retry path did not apply, because Retry
 * only accepts failed work.
 *
 * Reconciling marks those runs failed with an explicit reason, which puts them
 * back on the existing recovery path: Retry resets the unfinished tasks, keeps
 * the completed ones, and runs again.
 */
export class StaleRunReconciler {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRecorder: EventRecorder,
    /**
     * Only runs untouched for this long are reclaimed. A second API process
     * may legitimately be mid-execution on a task it started moments ago, and
     * a real objective takes minutes, so the window is deliberately well past
     * the longest run we expect rather than "anything not owned by me".
     */
    private readonly staleAfterMs = 15 * 60 * 1000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reconcile(): Promise<ReconcileResult> {
    const candidates = await this.workRepository.findByStatuses([
      "executing",
      "planning",
    ]);

    const recoveredWork: Work[] = [];
    let interruptedTaskCount = 0;

    for (const work of candidates) {
      if (!this.isStale(work)) {
        continue;
      }

      const tasks = await this.taskRepository.findByWork(work.id);
      const interrupted = tasks.filter(isInterrupted);

      const failedAt = this.now();

      for (const task of interrupted) {
        await this.taskRepository.update({
          ...task,
          status: "failed",
          completedAt: failedAt,
          updatedAt: failedAt,
          metadata: {
            ...task.metadata,
            execution: {
              status: "failed",
              error: {
                code: "EXECUTION_INTERRUPTED",
                message:
                  "The API process stopped while this task was running.",
              },
            },
          },
        });
      }

      interruptedTaskCount += interrupted.length;

      const recovered = await this.workRepository.update({
        ...work,
        status: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        metadata: {
          ...work.metadata,
          executionError:
            "Execution was interrupted by an API restart. Retry to resume from where it stopped.",
          interrupted: {
            detectedAt: failedAt.toISOString(),
            taskCount: interrupted.length,
          },
        },
      });

      await this.eventRecorder.record({
        organizationId: recovered.organizationId,
        workId: recovered.id,
        type: "work.failed",
        payload: {
          stage: "execution",
          reason: "Interrupted by an API restart.",
          interruptedTaskCount: interrupted.length,
        },
      });

      recoveredWork.push(recovered);
    }

    return { recoveredWork, interruptedTaskCount };
  }

  private isStale(work: Work): boolean {
    const lastTouched = work.updatedAt.getTime();

    return this.now().getTime() - lastTouched >= this.staleAfterMs;
  }
}

/**
 * A task the previous process had picked up or was about to. Pending tasks are
 * left alone - they never started, so Retry will pick them up untouched.
 */
function isInterrupted(task: Task): boolean {
  return task.status === "running" || task.status === "ready";
}
