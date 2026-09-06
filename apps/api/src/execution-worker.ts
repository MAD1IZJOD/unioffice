import { randomUUID } from "node:crypto";

import type { ExecutionJob } from "@unioffice/core";

import type { ExecutionJobRepository } from "@unioffice/database";

import type { ExecutionJobRunner } from "./execution-job-runner.js";

export interface ExecutionWorkerOptions {
  /** How long to wait after finding nothing to do. */
  pollIntervalMs: number;

  /** How long a claim is good for before another worker may take over. */
  leaseMs: number;

  /** How many jobs this worker will execute at once. */
  concurrency: number;

  /** Identifies this worker on the rows it claims. */
  workerId?: string;

  /** Injected in tests so a run can be observed without real timers. */
  sleep?: (ms: number) => Promise<void>;

  log?: (message: string) => void;
}

export interface WorkerTickResult {
  claimed: number;
  completed: number;
  requeued: number;
  failed: number;
}

const HEARTBEAT_DIVISOR = 3;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Takes jobs off the durable queue and executes them.
 *
 * The worker is deliberately dull: claim, run, settle, repeat. All the
 * interesting guarantees live in the queue - the unique index that stops the
 * same work being executed twice, and the compare-and-swap claim that stops
 * two workers taking the same job. That leaves this loop with nothing clever
 * to get wrong.
 */
export class ExecutionWorker {
  readonly workerId: string;

  private readonly pollIntervalMs: number;
  private readonly leaseMs: number;
  private readonly concurrency: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  private running = false;
  private stopped?: () => void;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly executionJobRepository: ExecutionJobRepository,
    private readonly executionJobRunner: ExecutionJobRunner,
    options: ExecutionWorkerOptions,
  ) {
    if (options.concurrency < 1) {
      throw new Error("Worker concurrency must be at least 1.");
    }

    if (options.leaseMs <= options.pollIntervalMs) {
      throw new Error(
        "The job lease must outlast the polling interval, or a worker would lose its own jobs while executing them.",
      );
    }

    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs;
    this.leaseMs = options.leaseMs;
    this.concurrency = options.concurrency;
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.log ?? ((message) => console.log(message));
  }

  /**
   * Returns jobs abandoned by workers that died to the queue.
   *
   * Deliberately not "mark everything failed": a job whose worker was killed
   * has usually not failed at all, it just lost its executor, so it goes back
   * on the queue for someone else to finish.
   */
  async recoverAbandonedJobs(
    now?: Date,
  ): Promise<{ requeued: number; failed: number }> {
    const recovered = await this.executionJobRepository.recoverExpiredLeases(
      now,
    );

    if (recovered.requeued.length > 0) {
      this.log(
        `Requeued ${recovered.requeued.length} job(s) abandoned by a worker that stopped responding.`,
      );
    }

    if (recovered.failed.length > 0) {
      this.log(
        `Gave up on ${recovered.failed.length} job(s) that ran out of attempts.`,
      );
    }

    return {
      requeued: recovered.requeued.length,
      failed: recovered.failed.length,
    };
  }

  /**
   * Claims and executes up to the concurrency limit once. Exposed separately
   * from the loop so tests can drive the worker deterministically.
   */
  async tick(): Promise<WorkerTickResult> {
    const result: WorkerTickResult = {
      claimed: 0,
      completed: 0,
      requeued: 0,
      failed: 0,
    };

    while (this.inFlight.size < this.concurrency) {
      const job = await this.executionJobRepository.claimNext({
        workerId: this.workerId,
        leaseMs: this.leaseMs,
      });

      if (!job) {
        break;
      }

      result.claimed += 1;
      this.log(`Claimed job ${job.id} for work ${job.workId}.`);

      const execution = this.execute(job, result).finally(() => {
        this.inFlight.delete(execution);
      });

      this.inFlight.add(execution);
    }

    // A tick that claimed nothing has nothing to wait for; one that did waits
    // so a caller driving ticks by hand sees settled counts.
    await Promise.all([...this.inFlight]);

    return result;
  }

  private async execute(
    job: ExecutionJob,
    result: WorkerTickResult,
  ): Promise<void> {
    // A real objective takes minutes, comfortably longer than any sane lease,
    // so the claim is kept alive while the work is genuinely progressing.
    const heartbeat = setInterval(() => {
      void this.executionJobRepository
        .heartbeat(job.id, this.workerId, this.leaseMs)
        .catch(() => {
          // A missed heartbeat is not fatal on its own; the lease only
          // matters once it actually expires.
        });
    }, Math.max(1000, Math.floor(this.leaseMs / HEARTBEAT_DIVISOR)));

    try {
      const outcome = await this.executionJobRunner.run(job);

      if (outcome.outcome === "completed") result.completed += 1;
      if (outcome.outcome === "requeued") result.requeued += 1;
      if (outcome.outcome === "failed") result.failed += 1;

      this.log(
        `Job ${job.id} ${outcome.outcome}${
          outcome.error ? `: ${outcome.error}` : "."
        }`,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  /** Polls until stop() is called. */
  async run(): Promise<void> {
    this.running = true;
    await this.recoverAbandonedJobs();

    this.log(
      `Worker ${this.workerId} polling every ${this.pollIntervalMs}ms, lease ${this.leaseMs}ms, concurrency ${this.concurrency}.`,
    );

    while (this.running) {
      try {
        const result = await this.tick();

        if (result.claimed === 0) {
          // Nothing to run. Recovery is retried on the idle path so a worker
          // left running alone still picks up jobs abandoned elsewhere.
          await this.recoverAbandonedJobs();
          await this.sleep(this.pollIntervalMs);
        }
      } catch (error) {
        this.log(
          `Worker loop error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.sleep(this.pollIntervalMs);
      }
    }

    this.stopped?.();
  }

  /** Stops after the current tick and waits for in-flight jobs to settle. */
  async stop(): Promise<void> {
    if (!this.running) return;

    const finished = new Promise<void>((resolve) => {
      this.stopped = resolve;
    });

    this.running = false;
    await finished;
    await Promise.all([...this.inFlight]);
  }
}
