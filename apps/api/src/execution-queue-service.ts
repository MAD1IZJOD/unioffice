import type {
  ExecutionJob,
  ExecutionJobReason,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  ExecutionJobRepository,
  WorkRepository,
  TaskRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";

export interface EnqueueExecutionResult {
  work: Work;
  tasks: Awaited<ReturnType<TaskRepository["findByWork"]>>;
  job: ExecutionJob;
  /** False when a job for this work was already queued or running. */
  enqueued: boolean;
}

/**
 * The single way execution is requested.
 *
 * Every caller - a user pressing Execute, an approval resuming its work, a
 * retry - puts a durable job on the queue instead of starting a background
 * task inside whichever process happened to receive the request. Nothing here
 * executes anything; a worker does that.
 */
export class ExecutionQueueService {
  constructor(
    private readonly executionJobRepository: ExecutionJobRepository,
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async enqueueWork(
    workId: WorkId,
    reason: ExecutionJobReason = "requested",
  ): Promise<EnqueueExecutionResult> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    const existing = await this.executionJobRepository.findActiveByWork(workId);

    if (existing) {
      // Already queued or running. Returning the existing job rather than
      // creating a second one is what keeps a retried request, a double
      // click or two callers from executing the same objective twice.
      return {
        work,
        tasks: await this.taskRepository.findByWork(workId),
        job: existing,
        enqueued: false,
      };
    }

    const job = await this.executionJobRepository.enqueue({
      organizationId: work.organizationId,
      workId: work.id,
      reason,
    });

    // A second caller can still lose the race to the unique index, in which
    // case enqueue returns the winner's job. Only announce work that this
    // call actually put on the queue.
    if (job.attempts === 0 && job.reason === reason) {
      await this.eventRecorder.record({
        organizationId: work.organizationId,
        workId: work.id,
        type: "work.queued",
        payload: {
          jobId: job.id,
          reason: job.reason,
        },
      });
    }

    return {
      work,
      tasks: await this.taskRepository.findByWork(workId),
      job,
      enqueued: true,
    };
  }

  async getActiveJob(workId: WorkId): Promise<ExecutionJob | null> {
    return this.executionJobRepository.findActiveByWork(workId);
  }

  async listJobs(
    organizationId: Work["organizationId"],
    limit?: number,
  ): Promise<ExecutionJob[]> {
    return this.executionJobRepository.findByOrganization(
      organizationId,
      limit,
    );
  }
}
