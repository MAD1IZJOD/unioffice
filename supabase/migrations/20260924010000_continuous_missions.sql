-- Missions that run on a schedule.
--
-- A continuous mission is a standing instruction: what to do, how often,
-- whose it is and whether it is running. It never executes anything. Each
-- time it comes due it starts an ordinary mission - a row in works - which is
-- planned, governed, approved and executed by the same queue and worker as a
-- mission a person started by hand. continuous_mission_runs only links the
-- two: which instruction, which occurrence, which mission.
--
-- A run's state is its mission row's state. Nothing here repeats it, so a run
-- can never read as finished in one place and failed in another.
--
-- The idempotency boundary is (continuous_mission_id, scheduled_for): one
-- occurrence, one run, enforced by the database. Starting a run is one
-- function, below, that locks the instruction, checks the occurrence is still
-- the one due, and writes the mission, the link and the next occurrence in a
-- single transaction - so a scheduler tick repeated, two workers racing, or a
-- process dying half way can never produce a second run or lose one.
--
-- Same posture as every other table: RLS enabled and forced, no browser-role
-- privileges; only the API's service role reads or writes it.

create table if not exists continuous_missions (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    -- Deleting a workspace must not quietly widen a mission to the whole
    -- company, so a workspace with continuous missions cannot be deleted
    -- until they are moved or cancelled.
    workspace_id uuid
        references workspaces(id),

    -- Whose it is. Every run is requested in their name.
    owner_id uuid not null,

    name text not null
        check (char_length(btrim(name)) between 1 and 120),

    objective text not null
        check (char_length(btrim(objective)) between 4 and 4000),

    briefing text
        check (briefing is null or char_length(briefing) <= 4000),

    priority text not null default 'normal'
        check (priority in ('low', 'normal', 'high', 'critical')),

    cadence text not null
        check (cadence in ('hourly', 'daily', 'weekdays', 'weekly')),

    -- 0 is Sunday. Only a weekly schedule has one.
    day_of_week smallint
        check (day_of_week between 0 and 6),

    -- Not for hourly, which runs at a minute past every hour.
    hour smallint
        check (hour between 0 and 23),

    minute smallint not null
        check (minute between 0 and 59),

    -- IANA name. Validated by the service, which can ask the runtime.
    timezone text not null
        check (char_length(timezone) between 1 and 64),

    status text not null default 'active'
        check (status in ('active', 'paused', 'cancelled')),

    pause_reason text
        check (pause_reason in ('person', 'repeated_failures')),

    -- When the next run is due. Present exactly while active: a paused or
    -- cancelled mission has no next run, and an active one always has one.
    next_run_at timestamptz,

    last_run_at timestamptz,

    run_count integer not null default 0
        check (run_count >= 0),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    created_by text,
    updated_by text,

    metadata jsonb not null default '{}'::jsonb,

    constraint continuous_missions_shape_check check (
        (cadence = 'weekly') = (day_of_week is not null)
        and (cadence = 'hourly') = (hour is null)
    ),

    constraint continuous_missions_next_run_check check (
        (status = 'active') = (next_run_at is not null)
    ),

    constraint continuous_missions_pause_check check (
        (status = 'paused') = (pause_reason is not null)
    )
);

-- The scheduler's one question: which active missions are due.
create index if not exists continuous_missions_due_idx
    on continuous_missions(next_run_at)
    where status = 'active';

create index if not exists continuous_missions_organization_idx
    on continuous_missions(organization_id, created_at desc);

create index if not exists continuous_missions_workspace_idx
    on continuous_missions(workspace_id)
    where workspace_id is not null;

-- Two live missions with one name in one organization is a mistake, and it
-- makes a run's "part of" line ambiguous. A cancelled one frees its name.
create unique index if not exists continuous_missions_unique_name_idx
    on continuous_missions(organization_id, lower(btrim(name)))
    where status <> 'cancelled';

create table if not exists continuous_mission_runs (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    continuous_mission_id uuid not null
        references continuous_missions(id)
        on delete cascade,

    -- One mission row per run, and a mission belongs to at most one run.
    work_id uuid not null unique
        references works(id)
        on delete cascade,

    sequence integer not null
        check (sequence >= 1),

    -- The occurrence this run is for. For a run started by hand, the moment
    -- it was asked for.
    scheduled_for timestamptz not null,

    trigger text not null
        check (trigger in ('schedule', 'manual')),

    created_at timestamptz not null default now(),

    -- The idempotency boundary: one occurrence, one run.
    constraint continuous_mission_runs_occurrence_key
        unique (continuous_mission_id, scheduled_for),

    constraint continuous_mission_runs_sequence_key
        unique (continuous_mission_id, sequence)
);

create index if not exists continuous_mission_runs_mission_idx
    on continuous_mission_runs(continuous_mission_id, sequence desc);

create index if not exists continuous_mission_runs_organization_idx
    on continuous_mission_runs(organization_id, created_at desc);

-- A scheduled run is queued with its own reason, so the worker knows it has
-- to plan the mission before executing it: nobody is holding a request open
-- to plan it, and nobody is going to press "Run it" afterwards.
alter table execution_jobs drop constraint if exists execution_jobs_reason_check;

alter table execution_jobs
    add constraint execution_jobs_reason_check
    check (reason in ('requested', 'approval_resumed', 'retry', 'recovered', 'scheduled'));

-- Starts one run, or does nothing.
--
-- Locks the instruction, then writes the run's mission, the link and the
-- instruction's new next occurrence together. Returns the run, or no row when
-- there is nothing to start: the mission is not active (or, for a run asked
-- for by hand, is cancelled), or - for a scheduled run - the occurrence the
-- caller saw is no longer the one due, because another scheduler started it
-- first. Returning nothing is the normal answer to a repeated tick, not an
-- error.
--
-- The mission row takes its objective, workspace, owner and priority from the
-- locked instruction, never from the caller, so a run is always what the
-- instruction said at the moment it started.
create or replace function start_continuous_mission_run(
    p_mission_id uuid,
    p_trigger text,
    p_expected_next_run_at timestamptz,
    p_scheduled_for timestamptz,
    p_next_run_at timestamptz,
    p_run_id uuid,
    p_work_id uuid,
    p_work_metadata jsonb,
    p_now timestamptz
)
returns setof continuous_mission_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
    mission continuous_missions%rowtype;
    run_sequence integer;
begin
    if p_trigger not in ('schedule', 'manual') then
        raise exception 'unknown run trigger: %', p_trigger;
    end if;

    select * into mission
    from continuous_missions
    where id = p_mission_id
    for update;

    if not found then
        return;
    end if;

    if p_trigger = 'schedule' then
        if mission.status <> 'active'
            or mission.next_run_at is distinct from p_expected_next_run_at
            or mission.next_run_at > p_now
            or p_next_run_at is null
            or p_next_run_at <= mission.next_run_at then
            return;
        end if;
    elsif mission.status = 'cancelled' then
        return;
    end if;

    run_sequence := mission.run_count + 1;

    insert into works (
        id, organization_id, workspace_id, requester_id, objective,
        status, priority, created_at, updated_at, metadata
    ) values (
        p_work_id,
        mission.organization_id,
        mission.workspace_id,
        mission.owner_id,
        mission.objective,
        'queued',
        mission.priority,
        p_now,
        p_now,
        coalesce(p_work_metadata, '{}'::jsonb)
            || case when mission.briefing is null
                    then '{}'::jsonb
                    else jsonb_build_object('briefing', mission.briefing) end
            || jsonb_build_object(
                'continuousMission', jsonb_build_object(
                    'id', mission.id,
                    'name', mission.name,
                    'sequence', run_sequence,
                    'scheduledFor', p_scheduled_for,
                    'trigger', p_trigger
                )
            )
    );

    insert into continuous_mission_runs (
        id, organization_id, continuous_mission_id, work_id,
        sequence, scheduled_for, trigger, created_at
    ) values (
        p_run_id,
        mission.organization_id,
        mission.id,
        p_work_id,
        run_sequence,
        p_scheduled_for,
        p_trigger,
        p_now
    );

    update continuous_missions
    set run_count = run_sequence,
        last_run_at = p_now,
        next_run_at = case when p_trigger = 'schedule' then p_next_run_at else next_run_at end,
        updated_at = p_now
    where id = mission.id;

    return query
        select * from continuous_mission_runs where id = p_run_id;
end;
$$;

alter table continuous_missions enable row level security;
alter table continuous_missions force row level security;
alter table continuous_mission_runs enable row level security;
alter table continuous_mission_runs force row level security;

revoke all on table continuous_missions from anon, authenticated;
revoke all on table continuous_mission_runs from anon, authenticated;
grant select, insert, update, delete on table continuous_missions to service_role;
grant select, insert, update, delete on table continuous_mission_runs to service_role;

revoke execute on function start_continuous_mission_run(uuid, text, timestamptz, timestamptz, timestamptz, uuid, uuid, jsonb, timestamptz)
    from public, anon, authenticated;
grant execute on function start_continuous_mission_run(uuid, text, timestamptz, timestamptz, timestamptz, uuid, uuid, jsonb, timestamptz)
    to service_role;
