import type {
  ContinuousMission,
  ContinuousMissionId,
  ContinuousMissionPauseReason,
  ContinuousMissionRun,
  ContinuousMissionRunId,
  ContinuousMissionRunTrigger,
  ContinuousMissionStatus,
  MissionCadence,
  OrganizationId,
  UserId,
  WorkId,
  WorkPriority,
  WorkspaceId,
  WorkStatus,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ContinuousMissionRepository,
  ContinuousMissionRunView,
  ContinuousMissionTransition,
  StartContinuousMissionRunInput,
} from "./continuous-mission-repository.js";

interface MissionRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  owner_id: string;
  name: string;
  objective: string;
  briefing: string | null;
  priority: WorkPriority;
  cadence: MissionCadence;
  day_of_week: number | null;
  hour: number | null;
  minute: number;
  timezone: string;
  status: ContinuousMissionStatus;
  pause_reason: ContinuousMissionPauseReason | null;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  metadata: Record<string, unknown> | null;
}

interface RunRow {
  id: string;
  organization_id: string;
  continuous_mission_id: string;
  work_id: string;
  sequence: number;
  scheduled_for: string;
  trigger: ContinuousMissionRunTrigger;
  created_at: string;
  works?: { status: WorkStatus; updated_at: string; completed_at: string | null } | null;
}

/** Postgres unique-violation: a second run for one occurrence, or a name in use. */
const UNIQUE_VIOLATION = "23505";

const RUN_WITH_WORK = "*, works!inner(status, updated_at, completed_at)";

function toMission(row: MissionRow): ContinuousMission {
  return {
    id: row.id as ContinuousMissionId,
    organizationId: row.organization_id as OrganizationId,
    workspaceId: row.workspace_id ? (row.workspace_id as WorkspaceId) : undefined,
    ownerId: row.owner_id as UserId,
    name: row.name,
    objective: row.objective,
    briefing: row.briefing ?? undefined,
    priority: row.priority,
    schedule: {
      cadence: row.cadence,
      dayOfWeek: row.day_of_week ?? undefined,
      hour: row.hour ?? undefined,
      minute: row.minute,
      timezone: row.timezone,
    },
    status: row.status,
    pauseReason: row.pause_reason ?? undefined,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at) : undefined,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined,
    runCount: row.run_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    createdBy: row.created_by ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function toRow(mission: ContinuousMission): MissionRow {
  return {
    id: mission.id,
    organization_id: mission.organizationId,
    workspace_id: mission.workspaceId ?? null,
    owner_id: mission.ownerId,
    name: mission.name,
    objective: mission.objective,
    briefing: mission.briefing ?? null,
    priority: mission.priority,
    cadence: mission.schedule.cadence,
    day_of_week: mission.schedule.dayOfWeek ?? null,
    hour: mission.schedule.hour ?? null,
    minute: mission.schedule.minute,
    timezone: mission.schedule.timezone,
    status: mission.status,
    pause_reason: mission.pauseReason ?? null,
    next_run_at: mission.nextRunAt?.toISOString() ?? null,
    last_run_at: mission.lastRunAt?.toISOString() ?? null,
    run_count: mission.runCount,
    created_at: mission.createdAt.toISOString(),
    updated_at: mission.updatedAt.toISOString(),
    created_by: mission.createdBy ?? null,
    updated_by: mission.updatedBy ?? null,
    metadata: mission.metadata,
  };
}

function toRun(row: RunRow): ContinuousMissionRun {
  return {
    id: row.id as ContinuousMissionRunId,
    organizationId: row.organization_id as OrganizationId,
    continuousMissionId: row.continuous_mission_id as ContinuousMissionId,
    workId: row.work_id as WorkId,
    sequence: row.sequence,
    scheduledFor: new Date(row.scheduled_for),
    trigger: row.trigger,
    createdAt: new Date(row.created_at),
  };
}

function toRunView(row: RunRow): ContinuousMissionRunView {
  const work = row.works;

  return {
    ...toRun(row),
    workStatus: work?.status ?? "queued",
    workUpdatedAt: new Date(work?.updated_at ?? row.created_at),
    workCompletedAt: work?.completed_at ? new Date(work.completed_at) : undefined,
  };
}

export class ContinuousMissionNameTakenError extends Error {
  constructor(name: string) {
    super(`A continuous mission called "${name}" already exists in this organization.`);
    this.name = "ContinuousMissionNameTakenError";
  }
}

export class SupabaseContinuousMissionRepository implements ContinuousMissionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(mission: ContinuousMission): Promise<ContinuousMission> {
    const { data, error } = await this.client
      .from("continuous_missions")
      .insert(toRow(mission))
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new ContinuousMissionNameTakenError(mission.name);
      throw new Error(`Failed to create continuous mission: ${error.message}`);
    }

    return toMission(data as MissionRow);
  }

  async findById(id: ContinuousMissionId): Promise<ContinuousMission | null> {
    const { data, error } = await this.client
      .from("continuous_missions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find continuous mission: ${error.message}`);

    return data ? toMission(data as MissionRow) : null;
  }

  async findByOrganization(
    organizationId: OrganizationId,
    options: { includeCancelled?: boolean } = {},
  ): Promise<ContinuousMission[]> {
    let request = this.client
      .from("continuous_missions")
      .select("*")
      .eq("organization_id", organizationId);

    if (!options.includeCancelled) request = request.neq("status", "cancelled");

    const { data, error } = await request.order("created_at", { ascending: false }).limit(200);

    if (error) throw new Error(`Failed to list continuous missions: ${error.message}`);

    return ((data as MissionRow[] | null) ?? []).map(toMission);
  }

  async findDue(now: Date, limit: number): Promise<ContinuousMission[]> {
    const { data, error } = await this.client
      .from("continuous_missions")
      .select("*")
      .eq("status", "active")
      .lte("next_run_at", now.toISOString())
      .order("next_run_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Failed to look for due continuous missions: ${error.message}`);

    return ((data as MissionRow[] | null) ?? []).map(toMission);
  }

  async transition(
    id: ContinuousMissionId,
    from: ContinuousMissionStatus[],
    to: ContinuousMissionTransition,
  ): Promise<ContinuousMission | null> {
    const { data, error } = await this.client
      .from("continuous_missions")
      .update({
        status: to.status,
        pause_reason: to.status === "paused" ? (to.pauseReason ?? "person") : null,
        next_run_at: to.status === "active" ? (to.nextRunAt?.toISOString() ?? null) : null,
        updated_at: to.now.toISOString(),
        ...(to.updatedBy ? { updated_by: to.updatedBy } : {}),
        ...(to.metadata ? { metadata: to.metadata } : {}),
      })
      .eq("id", id)
      .in("status", from)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new ContinuousMissionNameTakenError("that name");
      }
      throw new Error(`Failed to change continuous mission: ${error.message}`);
    }

    return data ? toMission(data as MissionRow) : null;
  }

  async advance(
    id: ContinuousMissionId,
    expected: Date,
    next: Date,
    now: Date,
  ): Promise<ContinuousMission | null> {
    const { data, error } = await this.client
      .from("continuous_missions")
      .update({ next_run_at: next.toISOString(), updated_at: now.toISOString() })
      .eq("id", id)
      .eq("status", "active")
      .eq("next_run_at", expected.toISOString())
      .select()
      .maybeSingle();

    if (error) throw new Error(`Failed to move a continuous mission on: ${error.message}`);

    return data ? toMission(data as MissionRow) : null;
  }

  async startRun(input: StartContinuousMissionRunInput): Promise<ContinuousMissionRun | null> {
    const { data, error } = await this.client.rpc("start_continuous_mission_run", {
      p_mission_id: input.continuousMissionId,
      p_trigger: input.trigger,
      p_expected_next_run_at: input.expectedNextRunAt?.toISOString() ?? null,
      p_scheduled_for: input.scheduledFor.toISOString(),
      p_next_run_at: input.nextRunAt?.toISOString() ?? null,
      p_run_id: input.runId,
      p_work_id: input.workId,
      p_work_metadata: input.workMetadata,
      p_now: input.now.toISOString(),
    });

    if (error) {
      // The occurrence already has a run. The function's own checks make
      // this unreachable in practice; the constraint is the backstop, and
      // meeting it means the run exists, not that anything went wrong.
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new Error(`Failed to start a continuous mission run: ${error.message}`);
    }

    const rows = (data as RunRow[] | null) ?? [];

    return rows[0] ? toRun(rows[0]) : null;
  }

  async findRuns(id: ContinuousMissionId, limit: number): Promise<ContinuousMissionRunView[]> {
    const { data, error } = await this.client
      .from("continuous_mission_runs")
      .select(RUN_WITH_WORK)
      .eq("continuous_mission_id", id)
      .order("sequence", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to read continuous mission runs: ${error.message}`);

    return ((data as RunRow[] | null) ?? []).map(toRunView);
  }

  async findRecentRuns(organizationId: OrganizationId, limit: number): Promise<ContinuousMissionRunView[]> {
    const { data, error } = await this.client
      .from("continuous_mission_runs")
      .select(RUN_WITH_WORK)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Failed to read recent continuous mission runs: ${error.message}`);

    return ((data as RunRow[] | null) ?? []).map(toRunView);
  }

  async findRunsAwaitingQueue(limit: number): Promise<ContinuousMissionRunView[]> {
    const { data, error } = await this.client
      .from("continuous_mission_runs")
      .select(RUN_WITH_WORK)
      .eq("works.status", "queued")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Failed to look for runs waiting to be queued: ${error.message}`);

    return ((data as RunRow[] | null) ?? []).map(toRunView);
  }
}
