import {
  createEntityId,
  describeSchedule,
  nextOccurrence,
  scheduleProblem,
  type ContinuousMission,
  type ContinuousMissionId,
  type ContinuousMissionRun,
  type ContinuousMissionRunId,
  type MissionSchedule,
  type OrganizationId,
  type UserId,
  type WorkId,
  type WorkPriority,
  type WorkspaceId,
  type WorkStatus,
} from "@unioffice/core";

import {
  ContinuousMissionNameTakenError,
  type ContinuousMissionRepository,
  type ContinuousMissionRunView,
  type OperationalReadRepository,
} from "@unioffice/database";

import type { EventRecorder } from "./event-recorder.js";
import type { OutcomeStatus } from "./mission-narrative-service.js";

/**
 * Continuous missions: the standing instructions, and what their runs did.
 *
 * Nothing here executes a mission. Starting a run writes an ordinary mission
 * row and puts it on the existing queue; planning, delegation, governance,
 * approvals, execution and what the company learns all happen exactly as
 * they do for a mission a person started by hand. This owns the instruction's
 * lifecycle - create, pause, resume, cancel, run now - and reads runs back in
 * a person's terms.
 *
 * Who may do each of these is decided at the route, by the same permission
 * rules every other mission route uses. The scheduler, which acts with nobody
 * signed in, lives in continuous-mission-scheduler.ts.
 */

export class ContinuousMissionNotFoundError extends Error {
  constructor(id: string) {
    super(`Continuous mission not found: ${id}`);
    this.name = "ContinuousMissionNotFoundError";
  }
}

export class ContinuousMissionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuousMissionValidationError";
  }
}

/** The request is fine; the mission is in a state that refuses it. Mapped to 409. */
export class ContinuousMissionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContinuousMissionStateError";
  }
}

/**
 * Where one run stands, in the vocabulary of the structured mission outcome.
 *
 *   running               queued, being planned or executing
 *   waiting_for_approval  stopped on a person's decision
 *   completed             did what it set out to do
 *   completed_with_limitations  finished, with something limiting the result
 *   blocked               a company rule refused a step, so it stopped
 *   failed                stopped without reaching an answer
 *   cancelled             someone stopped it
 */
export type RunState =
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "completed_with_limitations"
  | "blocked"
  | "failed"
  | "cancelled";

export interface RunSummary {
  sequence: number;
  workId: WorkId;
  trigger: ContinuousMissionRun["trigger"];
  scheduledFor: Date;
  startedAt: Date;
  finishedAt?: Date;
  state: RunState;
  /** One sentence on why it ended the way it did, when it did not simply finish. */
  note?: string;
}

export interface ContinuousMissionView {
  id: ContinuousMissionId;
  name: string;
  objective: string;
  briefing?: string;
  priority: WorkPriority;
  workspaceId?: WorkspaceId;
  schedule: MissionSchedule;
  /** The schedule as a person reads it. */
  cadence: string;
  status: ContinuousMission["status"];
  pauseReason?: ContinuousMission["pauseReason"];
  /** Why it is paused, in a sentence, when it paused itself. */
  pauseNote?: string;
  nextRunAt?: Date;
  lastRunAt?: Date;
  runCount: number;
  /** Whether the caller runs it: it runs in their name. */
  ownedByYou: boolean;
  createdAt: Date;
  updatedAt: Date;
  latestRun?: RunSummary;
}

export interface ContinuousMissionDetail extends ContinuousMissionView {
  runs: RunSummary[];
  /** Occurrences passed over because the run before was still going. */
  skipped: number;
}

export interface CreateContinuousMissionInput {
  organizationId: OrganizationId;
  workspaceId?: WorkspaceId;
  ownerId: UserId;
  name: string;
  objective: string;
  briefing?: string;
  priority?: WorkPriority;
  schedule: MissionSchedule;
  createdBy: string;
}

export interface ContinuousMissionDependencies {
  missions: ContinuousMissionRepository;
  queue: {
    enqueueWork(workId: WorkId, reason: "scheduled"): Promise<unknown>;
  };
  reads: Pick<OperationalReadRepository, "findEventsByTypes">;
  eventRecorder: EventRecorder;
  /**
   * The structured outcome of a finished run, read the way the mission room
   * reads it. Optional: without it a finished run reads as completed.
   */
  outcomeOf?: (workId: WorkId) => Promise<OutcomeStatus | undefined>;
  now?: () => Date;
}

/** How many runs a detail read returns, and how many of those get a full outcome. */
const DETAIL_RUNS = 20;
const OUTCOME_RUNS = 5;

const LIST_RUNS = 200;

export class ContinuousMissionService {
  private readonly now: () => Date;

  constructor(private readonly deps: ContinuousMissionDependencies) {
    this.now = deps.now ?? (() => new Date());
  }

  async create(input: CreateContinuousMissionInput): Promise<ContinuousMission> {
    const name = boundedText(input.name, "name", 1, 120);
    const objective = boundedText(input.objective, "objective", 4, 4000);
    const briefing = input.briefing?.trim() ? boundedText(input.briefing, "briefing", 1, 4000) : undefined;

    const problem = scheduleProblem(input.schedule);
    if (problem) throw new ContinuousMissionValidationError(problem);

    const now = this.now();
    const mission: ContinuousMission = {
      id: createEntityId<"ContinuousMissionId">() as ContinuousMissionId,
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      ownerId: input.ownerId,
      name,
      objective,
      briefing,
      priority: input.priority ?? "normal",
      schedule: normalizedSchedule(input.schedule),
      status: "active",
      nextRunAt: nextOccurrence(input.schedule, now),
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      metadata: {},
    };

    let created: ContinuousMission;

    try {
      created = await this.deps.missions.create(mission);
    } catch (error) {
      if (error instanceof ContinuousMissionNameTakenError) {
        throw new ContinuousMissionStateError(error.message);
      }
      throw error;
    }

    await this.record(created, "continuous_mission.created", input.createdBy, {
      cadence: describeSchedule(created.schedule),
      nextRunAt: created.nextRunAt?.toISOString(),
    });

    return created;
  }

  /** The instruction, read inside the organization. Another's reads as not found. */
  async find(organizationId: OrganizationId, id: ContinuousMissionId): Promise<ContinuousMission> {
    const mission = await this.deps.missions.findById(id);

    if (!mission || mission.organizationId !== organizationId) {
      throw new ContinuousMissionNotFoundError(id);
    }

    return mission;
  }

  async list(
    organizationId: OrganizationId,
    viewer: { userId: UserId; reach?: (workspaceId: WorkspaceId | undefined) => boolean },
  ): Promise<ContinuousMissionView[]> {
    const [missions, runs] = await Promise.all([
      this.deps.missions.findByOrganization(organizationId),
      this.deps.missions.findRecentRuns(organizationId, LIST_RUNS),
    ]);

    const visible = missions.filter((mission) => !viewer.reach || viewer.reach(mission.workspaceId));
    const latest = new Map<ContinuousMissionId, ContinuousMissionRunView>();

    for (const run of runs) {
      const seen = latest.get(run.continuousMissionId);
      if (!seen || run.sequence > seen.sequence) latest.set(run.continuousMissionId, run);
    }

    const blocked = await this.blockedRuns(organizationId, [...latest.values()]);

    return visible.map((mission) => {
      const run = latest.get(mission.id);
      return this.view(mission, viewer.userId, run ? summarize(run, blocked) : undefined);
    });
  }

  async get(
    organizationId: OrganizationId,
    id: ContinuousMissionId,
    viewer: { userId: UserId },
  ): Promise<ContinuousMissionDetail> {
    const mission = await this.find(organizationId, id);

    const [views, skippedEvents] = await Promise.all([
      this.deps.missions.findRuns(id, DETAIL_RUNS),
      this.deps.reads.findEventsByTypes(organizationId, { types: ["continuous_mission.run_skipped"], limit: 200 }),
    ]);

    const blocked = await this.blockedRuns(organizationId, views);
    const runs = views.map((run) => summarize(run, blocked));

    // The few most recent finished runs are read the way the mission room
    // reads them, so "finished" here can say "with limitations" when it was.
    if (this.deps.outcomeOf) {
      await Promise.all(runs.slice(0, OUTCOME_RUNS).map(async (run) => {
        if (run.state !== "completed") return;

        const outcome = await this.deps.outcomeOf!(run.workId).catch(() => undefined);

        if (outcome === "completed_with_limitations") {
          run.state = "completed_with_limitations";
          run.note = "It finished, but something limits what the result can be used for. The mission says what.";
        }
      }));
    }

    return {
      ...this.view(mission, viewer.userId, runs[0]),
      runs,
      skipped: skippedEvents.filter((event) => event.payload.continuousMissionId === id).length,
    };
  }

  async pause(organizationId: OrganizationId, id: ContinuousMissionId, actor: string): Promise<ContinuousMission> {
    const mission = await this.find(organizationId, id);

    const paused = await this.deps.missions.transition(mission.id, ["active"], {
      status: "paused",
      pauseReason: "person",
      updatedBy: actor,
      now: this.now(),
    });

    if (!paused) throw new ContinuousMissionStateError(stateRefusal(mission, "paused"));

    await this.record(paused, "continuous_mission.paused", actor, { reason: "person" });
    return paused;
  }

  /**
   * Starts it again from the next occurrence after now.
   *
   * Occurrences missed while it was paused are not made up: a paused mission
   * was told not to run, and a burst of catch-up runs on resuming is not what
   * anyone who paused it meant. Failures are counted afresh from here, so a
   * mission that paused itself does not stop again on the old failures.
   */
  async resume(organizationId: OrganizationId, id: ContinuousMissionId, actor: string): Promise<ContinuousMission> {
    const mission = await this.find(organizationId, id);
    const now = this.now();

    const resumed = await this.deps.missions.transition(mission.id, ["paused"], {
      status: "active",
      nextRunAt: nextOccurrence(mission.schedule, now),
      updatedBy: actor,
      metadata: { ...mission.metadata, failuresCountedFrom: now.toISOString() },
      now,
    });

    if (!resumed) throw new ContinuousMissionStateError(stateRefusal(mission, "active"));

    await this.record(resumed, "continuous_mission.resumed", actor, {
      previousReason: mission.pauseReason,
      nextRunAt: resumed.nextRunAt?.toISOString(),
    });
    return resumed;
  }

  /**
   * Ends it. Its runs stay on record, and a run already under way carries on
   * as the ordinary mission it is - it can be cancelled from its own page.
   */
  async cancel(organizationId: OrganizationId, id: ContinuousMissionId, actor: string): Promise<ContinuousMission> {
    const mission = await this.find(organizationId, id);

    const cancelled = await this.deps.missions.transition(mission.id, ["active", "paused"], {
      status: "cancelled",
      updatedBy: actor,
      now: this.now(),
    });

    if (!cancelled) throw new ContinuousMissionStateError(stateRefusal(mission, "cancelled"));

    await this.record(cancelled, "continuous_mission.cancelled", actor, {});
    return cancelled;
  }

  /**
   * A run now, asked for by a person, outside the schedule.
   *
   * The same rule as the schedule's own: one run at a time. The schedule
   * itself is left where it was.
   */
  async runNow(organizationId: OrganizationId, id: ContinuousMissionId, actor: string): Promise<ContinuousMissionRun> {
    const mission = await this.find(organizationId, id);

    if (mission.status === "cancelled") {
      throw new ContinuousMissionStateError("This continuous mission was cancelled, so it starts no more runs.");
    }

    const [latest] = await this.deps.missions.findRuns(mission.id, 1);

    if (latest && !isSettled(latest.workStatus)) {
      throw new ContinuousMissionStateError(
        `Run ${latest.sequence} is still going. A new run starts once it has finished or been cancelled.`,
      );
    }

    const now = this.now();
    const run = await this.deps.missions.startRun({
      continuousMissionId: mission.id,
      trigger: "manual",
      scheduledFor: now,
      runId: createEntityId<"ContinuousMissionRunId">() as ContinuousMissionRunId,
      workId: createEntityId<"WorkId">() as WorkId,
      // A person asked for this run and is here to see it, so it is not
      // marked as started by a schedule: rules about unattended work do not
      // apply to it.
      workMetadata: {},
      now,
    });

    if (!run) throw new ContinuousMissionStateError("That run could not be started. Try again in a moment.");

    await startedRun(this.deps.eventRecorder, mission, run, actor);
    await this.deps.queue.enqueueWork(run.workId, "scheduled");

    return run;
  }

  private view(mission: ContinuousMission, viewer: UserId, latestRun: RunSummary | undefined): ContinuousMissionView {
    return {
      id: mission.id,
      name: mission.name,
      objective: mission.objective,
      briefing: mission.briefing,
      priority: mission.priority,
      workspaceId: mission.workspaceId,
      schedule: mission.schedule,
      cadence: describeSchedule(mission.schedule),
      status: mission.status,
      pauseReason: mission.pauseReason,
      pauseNote: pauseNoteOf(mission),
      nextRunAt: mission.nextRunAt,
      lastRunAt: mission.lastRunAt,
      runCount: mission.runCount,
      ownedByYou: mission.ownerId === viewer,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      latestRun,
    };
  }

  /** Runs a company rule stopped, from the same step failures Mission Control reads. */
  private async blockedRuns(
    organizationId: OrganizationId,
    runs: ContinuousMissionRunView[],
  ): Promise<Map<WorkId, string | undefined>> {
    const failed = runs.filter((run) => run.workStatus === "failed").map((run) => run.workId);
    const blocked = new Map<WorkId, string | undefined>();

    if (failed.length === 0) return blocked;

    const events = await this.deps.reads.findEventsByTypes(organizationId, {
      types: ["task.failed"],
      workIds: failed,
      limit: 200,
    });

    for (const event of events) {
      if (!event.workId || blocked.has(event.workId)) continue;

      const governance = event.payload.governance as { outcome?: unknown; policyName?: unknown } | undefined;
      if (governance?.outcome !== "denied") continue;

      blocked.set(event.workId, typeof governance.policyName === "string" ? governance.policyName : undefined);
    }

    return blocked;
  }

  private async record(
    mission: ContinuousMission,
    type: Parameters<EventRecorder["record"]>[0]["type"],
    actor: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.eventRecorder.record({
      organizationId: mission.organizationId,
      actorType: actor ? "user" : "system",
      actorId: actor,
      type,
      payload: { continuousMissionId: mission.id, name: mission.name, ...payload },
    });
  }
}

/**
 * The audit lines for a run that has just started: the mission's own
 * creation, as every mission has, and the instruction's note that it ran.
 */
export async function startedRun(
  eventRecorder: EventRecorder,
  mission: ContinuousMission,
  run: ContinuousMissionRun,
  actor: string | undefined,
): Promise<void> {
  await eventRecorder.record({
    organizationId: mission.organizationId,
    workId: run.workId,
    actorType: actor ? "user" : "system",
    actorId: actor ?? mission.ownerId,
    type: "work.created",
    payload: {
      objective: mission.objective,
      priority: mission.priority,
      continuousMissionId: mission.id,
      sequence: run.sequence,
      trigger: run.trigger,
    },
  });

  await eventRecorder.record({
    organizationId: mission.organizationId,
    workId: run.workId,
    actorType: actor ? "user" : "system",
    actorId: actor,
    type: "continuous_mission.run_started",
    payload: {
      continuousMissionId: mission.id,
      name: mission.name,
      sequence: run.sequence,
      trigger: run.trigger,
      scheduledFor: run.scheduledFor.toISOString(),
    },
  });
}

/** A mission that will not change again without someone acting. */
export function isSettled(status: WorkStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function summarize(
  run: ContinuousMissionRunView,
  blocked: Map<WorkId, string | undefined>,
): RunSummary {
  const base = {
    sequence: run.sequence,
    workId: run.workId,
    trigger: run.trigger,
    scheduledFor: run.scheduledFor,
    startedAt: run.createdAt,
    finishedAt: isSettled(run.workStatus) ? (run.workCompletedAt ?? run.workUpdatedAt) : undefined,
  };

  switch (run.workStatus) {
    case "waiting_approval":
      return { ...base, state: "waiting_for_approval", note: "It is waiting for a person to decide a step." };
    case "completed":
      return { ...base, state: "completed" };
    case "cancelled":
      return { ...base, state: "cancelled" };
    case "failed":
      if (blocked.has(run.workId)) {
        const policy = blocked.get(run.workId);
        return {
          ...base,
          state: "blocked",
          note: policy ? `${policy} refused a step, so the run stopped there.` : "A company rule refused a step, so the run stopped there.",
        };
      }
      return { ...base, state: "failed" };
    default:
      return { ...base, state: "running" };
  }
}

function pauseNoteOf(mission: ContinuousMission): string | undefined {
  if (mission.status !== "paused") return undefined;

  switch (mission.pauseReason) {
    case "repeated_failures":
      return "It stopped itself after its last runs failed one after another. Look at why before resuming it.";
    case "owner_access":
      return "It stopped itself because the person it runs for can no longer start missions there.";
    default:
      return undefined;
  }
}

function stateRefusal(mission: ContinuousMission, wanted: ContinuousMission["status"]): string {
  if (mission.status === "cancelled") return "This continuous mission was cancelled and cannot be changed.";
  if (wanted === "paused") return "It is not running, so there is nothing to pause.";
  if (wanted === "active") return "It is already running.";
  return "It could not be changed from where it is now.";
}

function boundedText(value: string, field: string, min: number, max: number): string {
  const text = value.trim();

  if (text.length < min || text.length > max) {
    throw new ContinuousMissionValidationError(
      min === 1 ? `${field} is required and must be ${max} characters or fewer.` : `${field} must be between ${min} and ${max} characters.`,
    );
  }

  return text;
}

/** Only the fields its cadence uses, so what is stored is what is shown. */
function normalizedSchedule(schedule: MissionSchedule): MissionSchedule {
  return {
    cadence: schedule.cadence,
    ...(schedule.cadence === "weekly" ? { dayOfWeek: schedule.dayOfWeek } : {}),
    ...(schedule.cadence === "hourly" ? {} : { hour: schedule.hour }),
    minute: schedule.minute,
    timezone: schedule.timezone,
  };
}

