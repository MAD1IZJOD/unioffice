import type {
  ContinuousMission,
  ContinuousMissionId,
  ContinuousMissionRun,
  ContinuousMissionStatus,
  OrganizationId,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  ContinuousMissionRepository,
  ContinuousMissionRunView,
  ContinuousMissionTransition,
  StartContinuousMissionRunInput,
} from "./continuous-mission-repository.js";

import { ContinuousMissionNameTakenError } from "./supabase-continuous-mission-repository.js";

/** Where the in-memory store writes a run's mission, and reads it back. */
export interface InMemoryWorkSink {
  create(work: Work): Promise<Work>;
  findById(id: WorkId): Promise<Work | null>;
}

/**
 * Continuous missions kept in memory, implementing exactly the contract the
 * Supabase adapter implements.
 *
 * The database starts a run inside one locked transaction with a unique key
 * per occurrence; this does the same checks in the same order in code, with
 * nothing awaited between the check and the write, so two schedulers racing
 * here behave as two racing against Postgres do. A test that passes against
 * this is asserting what the real adapter must provide.
 */
export class InMemoryContinuousMissionRepository implements ContinuousMissionRepository {
  private readonly missions = new Map<ContinuousMissionId, ContinuousMission>();
  private readonly runs: ContinuousMissionRun[] = [];

  constructor(private readonly works: InMemoryWorkSink) {}

  allRuns(): ContinuousMissionRun[] {
    return [...this.runs];
  }

  async create(mission: ContinuousMission): Promise<ContinuousMission> {
    this.assertNameFree(mission);
    this.assertShape(mission);
    this.missions.set(mission.id, { ...mission });
    return { ...mission };
  }

  async findById(id: ContinuousMissionId): Promise<ContinuousMission | null> {
    const mission = this.missions.get(id);
    return mission ? { ...mission } : null;
  }

  async findByOrganization(
    organizationId: OrganizationId,
    options: { includeCancelled?: boolean } = {},
  ): Promise<ContinuousMission[]> {
    return [...this.missions.values()]
      .filter((mission) => mission.organizationId === organizationId)
      .filter((mission) => options.includeCancelled || mission.status !== "cancelled")
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((mission) => ({ ...mission }));
  }

  async findDue(now: Date, limit: number): Promise<ContinuousMission[]> {
    return [...this.missions.values()]
      .filter((mission) => mission.status === "active" && mission.nextRunAt && mission.nextRunAt.getTime() <= now.getTime())
      .sort((left, right) => left.nextRunAt!.getTime() - right.nextRunAt!.getTime())
      .slice(0, limit)
      .map((mission) => ({ ...mission }));
  }

  async transition(
    id: ContinuousMissionId,
    from: ContinuousMissionStatus[],
    to: ContinuousMissionTransition,
  ): Promise<ContinuousMission | null> {
    const current = this.missions.get(id);
    if (!current || !from.includes(current.status)) return null;

    const next: ContinuousMission = {
      ...current,
      status: to.status,
      pauseReason: to.status === "paused" ? (to.pauseReason ?? "person") : undefined,
      nextRunAt: to.status === "active" ? to.nextRunAt : undefined,
      updatedAt: to.now,
      updatedBy: to.updatedBy ?? current.updatedBy,
      metadata: to.metadata ?? current.metadata,
    };

    this.assertShape(next);
    this.missions.set(id, next);
    return { ...next };
  }

  async advance(
    id: ContinuousMissionId,
    expected: Date,
    next: Date,
    now: Date,
  ): Promise<ContinuousMission | null> {
    const current = this.missions.get(id);

    if (!current || current.status !== "active" || current.nextRunAt?.getTime() !== expected.getTime()) {
      return null;
    }

    const advanced = { ...current, nextRunAt: next, updatedAt: now };
    this.missions.set(id, advanced);
    return { ...advanced };
  }

  async startRun(input: StartContinuousMissionRunInput): Promise<ContinuousMissionRun | null> {
    // Everything from the check to the last write happens before the first
    // await, which is this store's equivalent of the row lock.
    const mission = this.missions.get(input.continuousMissionId);
    if (!mission) return null;

    if (input.trigger === "schedule") {
      if (
        mission.status !== "active" ||
        !input.expectedNextRunAt ||
        mission.nextRunAt?.getTime() !== input.expectedNextRunAt.getTime() ||
        mission.nextRunAt.getTime() > input.now.getTime() ||
        !input.nextRunAt ||
        input.nextRunAt.getTime() <= mission.nextRunAt.getTime()
      ) {
        return null;
      }
    } else if (mission.status === "cancelled") {
      return null;
    }

    const occurrenceTaken = this.runs.some(
      (run) => run.continuousMissionId === mission.id && run.scheduledFor.getTime() === input.scheduledFor.getTime(),
    );
    if (occurrenceTaken) return null;

    const sequence = mission.runCount + 1;

    const work: Work = {
      id: input.workId,
      organizationId: mission.organizationId,
      workspaceId: mission.workspaceId,
      requesterId: mission.ownerId,
      objective: mission.objective,
      status: "queued",
      priority: mission.priority,
      createdAt: input.now,
      updatedAt: input.now,
      metadata: {
        ...input.workMetadata,
        ...(mission.briefing ? { briefing: mission.briefing } : {}),
        continuousMission: {
          id: mission.id,
          name: mission.name,
          sequence,
          scheduledFor: input.scheduledFor.toISOString(),
          trigger: input.trigger,
        },
      },
    };

    const run: ContinuousMissionRun = {
      id: input.runId,
      organizationId: mission.organizationId,
      continuousMissionId: mission.id,
      workId: input.workId,
      sequence,
      scheduledFor: input.scheduledFor,
      trigger: input.trigger,
      createdAt: input.now,
    };

    this.runs.push(run);
    this.missions.set(mission.id, {
      ...mission,
      runCount: sequence,
      lastRunAt: input.now,
      nextRunAt: input.trigger === "schedule" ? input.nextRunAt : mission.nextRunAt,
      updatedAt: input.now,
    });

    await this.works.create(work);

    return { ...run };
  }

  async findRuns(id: ContinuousMissionId, limit: number): Promise<ContinuousMissionRunView[]> {
    const runs = this.runs
      .filter((run) => run.continuousMissionId === id)
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, limit);

    return this.views(runs);
  }

  async findRecentRuns(organizationId: OrganizationId, limit: number): Promise<ContinuousMissionRunView[]> {
    const runs = this.runs
      .filter((run) => run.organizationId === organizationId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);

    return this.views(runs);
  }

  async findRunsAwaitingQueue(limit: number): Promise<ContinuousMissionRunView[]> {
    const views = await this.views(
      [...this.runs].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    );

    return views.filter((view) => view.workStatus === "queued").slice(0, limit);
  }

  private async views(runs: ContinuousMissionRun[]): Promise<ContinuousMissionRunView[]> {
    const views: ContinuousMissionRunView[] = [];

    for (const run of runs) {
      const work = await this.works.findById(run.workId);
      if (!work) continue;

      views.push({
        ...run,
        workStatus: work.status,
        workUpdatedAt: work.updatedAt,
        workCompletedAt: work.completedAt,
      });
    }

    return views;
  }

  /** Mirrors the unique index on (organization, lower(trim(name))) for live missions. */
  private assertNameFree(mission: ContinuousMission): void {
    const key = mission.name.trim().toLowerCase();
    const taken = [...this.missions.values()].some(
      (other) =>
        other.id !== mission.id &&
        other.organizationId === mission.organizationId &&
        other.status !== "cancelled" &&
        other.name.trim().toLowerCase() === key,
    );

    if (taken) throw new ContinuousMissionNameTakenError(mission.name);
  }

  /** Mirrors the lifecycle check constraints. */
  private assertShape(mission: ContinuousMission): void {
    if ((mission.status === "active") !== (mission.nextRunAt !== undefined)) {
      throw new Error("continuous_missions_next_run_check: an active mission has a next run, and only an active one.");
    }

    if ((mission.status === "paused") !== (mission.pauseReason !== undefined)) {
      throw new Error("continuous_missions_pause_check: a paused mission says why, and only a paused one.");
    }
  }
}
