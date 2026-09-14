import type {
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  ApprovalRepository,
  ExecutionJobRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

/**
 * Cancelling a mission: a person decides it should not run.
 *
 * Until now nothing could move a mission into `cancelled`, although the status
 * existed, so a mission nobody wanted any more could only be retried or left
 * to sit in the attention queue. Cancelling is terminal and keeps everything:
 * the plan, finished steps, artifacts and events all remain, and the record
 * says who cancelled it and why.
 *
 * It refuses exactly the cases where cancelling would race real work:
 *
 * - a worker is running the mission right now - its steps keep writing, and a
 *   cancellation would be overwritten or leave half-finished rows;
 * - the plan is being written right now - the planner writes the mission back
 *   to queued when it finishes.
 *
 * A job still waiting on the queue is taken off it with the same
 * compare-and-swap a worker's claim uses, so the two can never both win.
 */

export class WorkCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkCancellationError";
  }
}

export interface CancelWorkResult {
  work: Work;
  cancelledTaskCount: number;
  closedApprovalCount: number;
  cancelledJob: boolean;
}

const FINISHED_TASK: Task["status"][] = ["completed", "failed", "cancelled"];

export class WorkCancellationService {
  private readonly planningStaleAfterMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly workRepository: Pick<WorkRepository, "findById" | "update">,
    private readonly taskRepository: Pick<TaskRepository, "findByWork" | "update">,
    private readonly jobs: Pick<ExecutionJobRepository, "findActiveByWork" | "cancel">,
    private readonly approvals: Pick<ApprovalRepository, "findByWork" | "resolvePending">,
    private readonly eventRecorder: Pick<EventRecorder, "record">,
    options: { planningStaleAfterMs?: number; now?: () => Date } = {},
  ) {
    this.planningStaleAfterMs = options.planningStaleAfterMs ?? 15 * 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async cancelWork(
    workId: WorkId,
    input: {
      /** The person cancelling, as a user id. Recorded on closed decisions. */
      actorId: string;
      reason?: string;
    },
  ): Promise<CancelWorkResult> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    if (work.status === "completed" || work.status === "cancelled") {
      throw new WorkCancellationError(`This mission is already ${work.status}; there is nothing to cancel.`);
    }

    if (
      work.status === "planning" &&
      this.now().getTime() - work.updatedAt.getTime() <= this.planningStaleAfterMs
    ) {
      throw new WorkCancellationError(
        "The plan is being written right now. Cancel the mission once planning has finished.",
      );
    }

    const job = await this.jobs.findActiveByWork(work.id);

    if (job?.status === "running") {
      throw new WorkCancellationError(
        "A worker is running this mission right now. Cancel it once the current run stops or waits for a decision.",
      );
    }

    const reason = input.reason?.trim() || "Cancelled by a person.";
    const now = this.now();

    let cancelledJob = false;

    if (job) {
      const cancelled = await this.jobs.cancel(job.id, reason, now);

      // A null here means a worker claimed the job between the read and this
      // write. The worker won; the mission is running and is left alone.
      if (!cancelled) {
        throw new WorkCancellationError(
          "A worker picked this mission up just now. Cancel it once the current run stops.",
        );
      }

      cancelledJob = true;
    }

    let closedApprovalCount = 0;

    for (const approval of await this.approvals.findByWork(work.id)) {
      if (approval.status !== "pending") continue;

      const closed = await this.approvals.resolvePending({
        ...approval,
        status: "cancelled",
        resolvedAt: now,
        resolvedBy: input.actorId,
        metadata: { ...approval.metadata, closedBecause: "The mission was cancelled." },
      });

      if (closed) closedApprovalCount += 1;
    }

    const tasks = await this.taskRepository.findByWork(work.id);
    let cancelledTaskCount = 0;

    for (const task of tasks) {
      if (FINISHED_TASK.includes(task.status)) continue;

      await this.taskRepository.update({
        ...task,
        status: "cancelled",
        completedAt: now,
        updatedAt: now,
      });

      cancelledTaskCount += 1;
    }

    const cancelledWork = await this.workRepository.update({
      ...work,
      status: "cancelled",
      completedAt: now,
      updatedAt: now,
      metadata: {
        ...work.metadata,
        waitingTaskId: undefined,
        cancellation: {
          at: now.toISOString(),
          by: input.actorId,
          reason,
          previousStatus: work.status,
        },
      },
    });

    await this.eventRecorder.record({
      organizationId: cancelledWork.organizationId,
      workId: cancelledWork.id,
      actorType: "user",
      actorId: input.actorId,
      type: "work.cancelled",
      payload: {
        reason,
        previousStatus: work.status,
        cancelledTaskCount,
        closedApprovalCount,
      },
    });

    return { work: cancelledWork, cancelledTaskCount, closedApprovalCount, cancelledJob };
  }
}
