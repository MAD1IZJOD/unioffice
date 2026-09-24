import {
  createEntityId,
  nextOccurrence,
  REPEATED_FAILURE_LIMIT,
  type ContinuousMission,
  type ContinuousMissionRunId,
  type WorkId,
  type WorkspaceAccessLevel,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  ContinuousMissionRepository,
  ExecutionJobRepository,
  MembershipRepository,
} from "@unioffice/database";

import { canActIn, type Access } from "./access/permissions.js";
import { isSettled, startedRun } from "./continuous-mission-service.js";
import type { EventRecorder } from "./event-recorder.js";

/**
 * Starts the runs that have come due.
 *
 * The source of truth is the database, never a timer: each mission row says
 * when its next run is due, and a tick only asks which rows are due now. The
 * worker calls this on its own loop, so schedules run with the browser closed
 * and pick up where they were after any restart - an occurrence that fell due
 * while nothing was running is started on the first tick afterwards, once,
 * and the schedule moves on from the present rather than replaying every
 * occurrence it missed.
 *
 * A tick can be repeated, run by two workers at once, or cut short at any
 * point without starting anything twice: starting a run is one transaction
 * that only succeeds for the occurrence that is still due, and queueing is
 * idempotent per mission.
 *
 * Before anything starts, three things are checked, each from real state:
 *
 * - The owner can still start missions there. Every run is in their name,
 *   and a schedule must not outlive the permission it was created under.
 * - The previous run has finished. One run at a time: an occurrence that
 *   falls due while the last run is still going, or still waiting on a
 *   person, is skipped and recorded rather than stacked up behind it.
 * - Its runs have not been failing one after another. After
 *   REPEATED_FAILURE_LIMIT of them it stops itself and says so, rather than
 *   failing on schedule forever.
 */

export interface SchedulerTickResult {
  started: number;
  skipped: number;
  paused: number;
  requeued: number;
}

export interface ContinuousMissionSchedulerDependencies {
  missions: ContinuousMissionRepository;
  jobs: Pick<ExecutionJobRepository, "findActiveByWork">;
  queue: { enqueueWork(workId: WorkId, reason: "scheduled"): Promise<unknown> };
  members: Pick<MembershipRepository, "findMemberByUser" | "listWorkspaceGrantsForMember">;
  eventRecorder: EventRecorder;
  now?: () => Date;
  log?: (message: string) => void;
}

/** How many due missions one tick takes on. The rest wait for the next. */
const DUE_PER_TICK = 10;

/** How many unqueued runs one tick looks at. */
const STRANDED_PER_TICK = 20;

/**
 * A run is only treated as stranded once it has sat unqueued this long, so
 * the scheduler never races the code path that is about to queue it.
 */
const STRANDED_AFTER_MS = 60_000;

export class ContinuousMissionScheduler {
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: ContinuousMissionSchedulerDependencies) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? ((message) => console.log(message));
  }

  async tick(): Promise<SchedulerTickResult> {
    const result: SchedulerTickResult = { started: 0, skipped: 0, paused: 0, requeued: 0 };

    result.requeued = await this.queueStrandedRuns();

    for (const mission of await this.deps.missions.findDue(this.now(), DUE_PER_TICK)) {
      try {
        const outcome = await this.consider(mission);
        result[outcome] += 1;
      } catch (error) {
        // One mission's trouble is not every mission's: the rest of the tick
        // goes ahead, and this one is looked at again next tick.
        this.log(`Could not start a run of continuous mission ${mission.id}: ${errorMessage(error)}`);
      }
    }

    return result;
  }

  /**
   * Queues runs whose mission was written but never put on the queue - a
   * process that died between the two. A run whose mission already has a job
   * is left alone; enqueueing twice would be refused anyway.
   */
  private async queueStrandedRuns(): Promise<number> {
    const cutoff = this.now().getTime() - STRANDED_AFTER_MS;
    let queued = 0;

    for (const run of await this.deps.missions.findRunsAwaitingQueue(STRANDED_PER_TICK)) {
      if (run.workUpdatedAt.getTime() > cutoff) continue;
      if (await this.deps.jobs.findActiveByWork(run.workId)) continue;

      await this.deps.queue.enqueueWork(run.workId, "scheduled");
      queued += 1;
    }

    if (queued > 0) this.log(`Queued ${queued} scheduled run(s) that were started but never queued.`);

    return queued;
  }

  private async consider(mission: ContinuousMission): Promise<"started" | "skipped" | "paused"> {
    const now = this.now();
    const due = mission.nextRunAt!;

    if (!(await this.ownerMayStillRun(mission))) {
      return this.stop(mission, "owner_access", now);
    }

    const recent = await this.deps.missions.findRuns(mission.id, REPEATED_FAILURE_LIMIT);
    const latest = recent[0];

    if (latest && !isSettled(latest.workStatus)) {
      const advanced = await this.deps.missions.advance(mission.id, due, nextOccurrence(mission.schedule, now), now);

      if (advanced) {
        await this.deps.eventRecorder.record({
          organizationId: mission.organizationId,
          workId: latest.workId,
          type: "continuous_mission.run_skipped",
          payload: {
            continuousMissionId: mission.id,
            name: mission.name,
            scheduledFor: due.toISOString(),
            stillRunning: latest.sequence,
            reason: latest.workStatus === "waiting_approval" ? "previous_run_waiting_for_approval" : "previous_run_in_progress",
          },
        });
      }

      return "skipped";
    }

    if (failingRepeatedly(mission, recent)) {
      return this.stop(mission, "repeated_failures", now);
    }

    const run = await this.deps.missions.startRun({
      continuousMissionId: mission.id,
      trigger: "schedule",
      expectedNextRunAt: due,
      scheduledFor: due,
      nextRunAt: nextOccurrence(mission.schedule, now),
      runId: createEntityId<"ContinuousMissionRunId">() as ContinuousMissionRunId,
      workId: createEntityId<"WorkId">() as WorkId,
      // The mark governance reads: nobody started this run by hand, so rules
      // about unattended work apply to it.
      workMetadata: { startedBy: "schedule" },
      now,
    });

    // Another scheduler started this occurrence first. Nothing to do.
    if (!run) return "skipped";

    await startedRun(this.deps.eventRecorder, mission, run, undefined);
    await this.deps.queue.enqueueWork(run.workId, "scheduled");

    this.log(`Started run ${run.sequence} of continuous mission ${mission.id}.`);

    return "started";
  }

  private async stop(
    mission: ContinuousMission,
    reason: "owner_access" | "repeated_failures",
    now: Date,
  ): Promise<"paused"> {
    const paused = await this.deps.missions.transition(mission.id, ["active"], {
      status: "paused",
      pauseReason: reason,
      now,
    });

    if (paused) {
      await this.deps.eventRecorder.record({
        organizationId: mission.organizationId,
        type: "continuous_mission.paused",
        payload: { continuousMissionId: mission.id, name: mission.name, reason },
      });

      this.log(`Paused continuous mission ${mission.id}: ${reason}.`);
    }

    return "paused";
  }

  /**
   * Whether the owner could start this mission themselves, right now, by the
   * same permission rules a request is held to.
   */
  private async ownerMayStillRun(mission: ContinuousMission): Promise<boolean> {
    const member = await this.deps.members.findMemberByUser(mission.organizationId, mission.ownerId);

    if (!member || member.status !== "active") return false;

    const grants = await this.deps.members.listWorkspaceGrantsForMember(mission.organizationId, member.id);

    const access: Access = {
      userId: mission.ownerId,
      email: member.email,
      organizationId: mission.organizationId,
      memberId: member.id,
      role: member.role,
      workspaces: new Map<WorkspaceId, WorkspaceAccessLevel>(grants.map((grant) => [grant.workspaceId, grant.access])),
    };

    return canActIn(access, "missions.create", mission.workspaceId);
  }
}

/**
 * The last REPEATED_FAILURE_LIMIT runs all failed, counting only runs since
 * it was last resumed - resuming a mission that stopped itself is a person
 * saying "try again", not "stop again on the same failures".
 */
function failingRepeatedly(
  mission: ContinuousMission,
  recent: Awaited<ReturnType<ContinuousMissionRepository["findRuns"]>>,
): boolean {
  const countedFrom = typeof mission.metadata.failuresCountedFrom === "string"
    ? new Date(mission.metadata.failuresCountedFrom).getTime()
    : Number.NEGATIVE_INFINITY;

  const counted = recent.filter((run) => run.createdAt.getTime() >= countedFrom);

  return counted.length >= REPEATED_FAILURE_LIMIT && counted.every((run) => run.workStatus === "failed");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
