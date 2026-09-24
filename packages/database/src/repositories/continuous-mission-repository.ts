import type {
  ContinuousMission,
  ContinuousMissionId,
  ContinuousMissionPauseReason,
  ContinuousMissionRun,
  ContinuousMissionRunId,
  ContinuousMissionRunTrigger,
  ContinuousMissionStatus,
  OrganizationId,
  WorkId,
  WorkStatus,
} from "@unioffice/core";

export interface StartContinuousMissionRunInput {
  continuousMissionId: ContinuousMissionId;
  trigger: ContinuousMissionRunTrigger;
  /**
   * For a scheduled run: the occurrence the caller saw as due. The run starts
   * only if it is still the one due, so a second scheduler that saw the same
   * occurrence starts nothing.
   */
  expectedNextRunAt?: Date;
  /** The occurrence this run is for; for a run asked for by hand, now. */
  scheduledFor: Date;
  /** For a scheduled run, the occurrence after this one. */
  nextRunAt?: Date;
  runId: ContinuousMissionRunId;
  workId: WorkId;
  /** System-written fields for the run's mission row. */
  workMetadata: Record<string, unknown>;
  now: Date;
}

/** A run and where its mission stands, from one read. */
export interface ContinuousMissionRunView extends ContinuousMissionRun {
  workStatus: WorkStatus;
  workUpdatedAt: Date;
  workCompletedAt?: Date;
}

export interface ContinuousMissionTransition {
  status: ContinuousMissionStatus;
  pauseReason?: ContinuousMissionPauseReason;
  nextRunAt?: Date;
  updatedBy?: string;
  now: Date;
}

export interface ContinuousMissionRepository {
  create(mission: ContinuousMission): Promise<ContinuousMission>;

  findById(id: ContinuousMissionId): Promise<ContinuousMission | null>;

  findByOrganization(
    organizationId: OrganizationId,
    options?: { includeCancelled?: boolean },
  ): Promise<ContinuousMission[]>;

  /** Active missions whose next run is due at or before `now`, oldest first. */
  findDue(now: Date, limit: number): Promise<ContinuousMission[]>;

  /**
   * Moves a mission between states, only if it is currently in one of
   * `from`. Returns null when it was not - already paused, cancelled, or gone
   * - so two people pressing Pause at once cannot both change it.
   */
  transition(
    id: ContinuousMissionId,
    from: ContinuousMissionStatus[],
    to: ContinuousMissionTransition,
  ): Promise<ContinuousMission | null>;

  /**
   * Moves an active mission's next run on without starting one, only if its
   * next run is still `expected`. Used when an occurrence is skipped.
   */
  advance(
    id: ContinuousMissionId,
    expected: Date,
    next: Date,
    now: Date,
  ): Promise<ContinuousMission | null>;

  /**
   * Starts one run - its mission row, the link and the next occurrence - in
   * one step, or returns null when there is nothing to start. Never creates
   * two runs for one occurrence.
   */
  startRun(input: StartContinuousMissionRunInput): Promise<ContinuousMissionRun | null>;

  /** A mission's runs, newest first, with their missions' states. */
  findRuns(id: ContinuousMissionId, limit: number): Promise<ContinuousMissionRunView[]>;

  /** An organization's most recent runs, newest first. */
  findRecentRuns(organizationId: OrganizationId, limit: number): Promise<ContinuousMissionRunView[]>;

  /**
   * Runs whose mission is still waiting to be taken up, oldest first. A run
   * is created and then queued; a process that dies between the two leaves
   * one of these, and the scheduler queues it on its next pass.
   */
  findRunsAwaitingQueue(limit: number): Promise<ContinuousMissionRunView[]>;
}
