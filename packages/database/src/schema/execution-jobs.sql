-- Durable execution queue.
--
-- Execution previously lived in the API process's memory, so a restart
-- stranded whatever was mid-flight. A job is a row: it outlives the process
-- that created it, and any worker can claim and finish it.
--
-- This table orchestrates execution only. Works, tasks, artifacts, memories
-- and events remain the source of truth for business state.

create table if not exists execution_jobs (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid not null
        references works(id)
        on delete cascade,

    status text not null default 'queued'
        check (
            status in (
                'queued',
                'running',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    reason text not null default 'requested'
        check (
            reason in (
                'requested',
                'approval_resumed',
                'retry',
                'recovered'
            )
        ),

    attempts integer not null default 0
        check (attempts >= 0),

    max_attempts integer not null default 3
        check (max_attempts >= 1),

    -- Not eligible to be claimed before this instant, so a recoverable
    -- failure can back off instead of spinning.
    run_at timestamptz not null default now(),

    -- When the current claim goes stale. A worker that dies mid-run leaves
    -- this in the past, which is how another worker knows the job was
    -- abandoned rather than being actively executed.
    lease_expires_at timestamptz,

    claimed_by text,

    claimed_at timestamptz,

    last_error text,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

-- The duplicate-execution guard. At most one queued or running job may exist
-- per work item, enforced by the database rather than by application checks,
-- so a double-click, a retried request or two code paths asking at once
-- cannot start the same objective twice.
create unique index if not exists execution_jobs_one_active_per_work_idx
    on execution_jobs(work_id)
    where status in ('queued', 'running');

-- Supports the claim query: the oldest runnable job first.
create index if not exists execution_jobs_runnable_idx
    on execution_jobs(status, run_at)
    where status in ('queued', 'running');

create index if not exists execution_jobs_organization_idx
    on execution_jobs(organization_id);

create index if not exists execution_jobs_work_idx
    on execution_jobs(work_id);

-- Supports stale-lease recovery.
create index if not exists execution_jobs_lease_idx
    on execution_jobs(lease_expires_at)
    where status = 'running';
