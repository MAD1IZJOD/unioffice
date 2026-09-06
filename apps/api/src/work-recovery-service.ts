import type {
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  EventRecorder,
} from "./event-recorder.js";

export interface RetryWorkResult {
  work: Work;
  tasks: Task[];
  /**
   * "replan" means the work never produced tasks and has to go through the
   * planner again; "resume" means its plan survived and only the failed tasks
   * were reset. The caller uses this to decide whether to plan before
   * executing, rather than guessing from the task count.
   */
  mode: "replan" | "resume";
}

/**
 * Puts failed work back into a runnable state.
 *
 * A failed work item was previously terminal - a planner hiccup or one
 * unlucky task threw away every completed task alongside it. Retrying keeps
 * the completed tasks and only resets what actually failed, so a retry costs
 * one task's worth of model time instead of the whole objective's.
 */
export class WorkRecoveryService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async retryWork(workId: WorkId): Promise<RetryWorkResult> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    if (work.status !== "failed") {
      throw new Error(
        `Only failed work can be retried; this work is ${work.status}.`,
      );
    }

    const tasks = await this.taskRepository.findByWork(workId);
    const resettableTasks = tasks.filter(isResettable);
    const mode: RetryWorkResult["mode"] =
      tasks.length === 0 ? "replan" : "resume";

    const now = new Date();
    const resetTasks = await Promise.all(
      resettableTasks.map((task) =>
        this.taskRepository.update({
          ...task,
          status: "pending",
          startedAt: undefined,
          completedAt: undefined,
          updatedAt: now,
          metadata: {
            ...task.metadata,
            execution: undefined,
            retry: {
              previousStatus: task.status,
              retriedAt: now.toISOString(),
            },
          },
        }),
      ),
    );

    const retriedWork = await this.workRepository.update({
      ...work,
      status: "queued",
      completedAt: undefined,
      updatedAt: now,
      metadata: {
        ...work.metadata,
        executionError: undefined,
        planningError: undefined,
        retry: {
          retriedAt: now.toISOString(),
          mode,
          resetTaskCount: resetTasks.length,
          previousError:
            work.metadata.executionError ?? work.metadata.planningError,
        },
      },
    });

    await this.eventRecorder.record({
      organizationId: retriedWork.organizationId,
      workId: retriedWork.id,
      type: "work.retried",
      payload: {
        mode,
        resetTaskCount: resetTasks.length,
        preservedTaskCount: tasks.length - resetTasks.length,
      },
    });

    return {
      work: retriedWork,
      tasks: await this.taskRepository.findByWork(workId),
      mode,
    };
  }
}

/**
 * Completed tasks keep their results - the point of a retry is to avoid
 * re-running work that already succeeded. Everything else was either
 * interrupted or never started, so it goes back to pending.
 */
function isResettable(task: Task): boolean {
  return task.status !== "completed";
}
