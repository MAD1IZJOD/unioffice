import type { WorkId } from "@unioffice/core";

/**
 * Plans a mission and puts it on the queue - on the server, in one go.
 *
 * Planning takes one to two minutes on a local model. When the browser held
 * that request open and then asked for the mission to be queued as a second
 * call, anything that interrupted the browser in between - a closed tab, a
 * laptop going to sleep, a dropped connection, a proxy giving up on a long
 * request - left the mission planned but never queued. It read as "queued"
 * while nothing would ever run it.
 *
 * Here the second step cannot be lost: the request that starts a launch
 * returns at once, and planning and queueing happen together on the server
 * whether or not anyone is still watching. The room shows progress from the
 * mission's own state, as it already did.
 *
 * Launches are tracked per mission in this process, so a double click or a
 * retried request does not plan the same mission twice. One API instance is
 * the supported shape; see docs/deployment.
 */
export class MissionLauncher {
  private readonly inFlight = new Set<WorkId>();

  constructor(
    private readonly deps: {
      planWork(workId: WorkId): Promise<unknown>;
      enqueueWork(workId: WorkId): Promise<unknown>;
      /** Told about a failure nobody is waiting on, so it is not lost. */
      onError?(workId: WorkId, stage: "planning" | "queueing", error: unknown): void;
    },
  ) {}

  /** Whether this mission is being launched right now. */
  isLaunching(workId: WorkId): boolean {
    return this.inFlight.has(workId);
  }

  /**
   * Starts planning and returns without waiting for it.
   *
   * `started` is false when this mission is already being launched. `settled`
   * resolves once planning and queueing are done or have failed; the API does
   * not wait on it, and it never rejects.
   */
  launch(workId: WorkId): { started: boolean; settled: Promise<void> } {
    if (this.inFlight.has(workId)) {
      return { started: false, settled: Promise.resolve() };
    }

    this.inFlight.add(workId);

    const settled = this.run(workId).finally(() => {
      this.inFlight.delete(workId);
    });

    return { started: true, settled };
  }

  private async run(workId: WorkId): Promise<void> {
    try {
      await this.deps.planWork(workId);
    } catch (error) {
      // Planning records its own failure on the mission, which is where the
      // room reads it from. Nothing is queued after a failed plan.
      this.deps.onError?.(workId, "planning", error);
      return;
    }

    try {
      await this.deps.enqueueWork(workId);
    } catch (error) {
      // The plan stands. The room offers "Run it" for a planned mission with
      // nothing on the queue, so this is recoverable by hand.
      this.deps.onError?.(workId, "queueing", error);
    }
  }
}
