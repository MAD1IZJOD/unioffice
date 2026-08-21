create table if not exists tasks (
    id uuid primary key,

    work_id uuid not null
        references works(id)
        on delete cascade,

    parent_task_id uuid
        references tasks(id)
        on delete cascade,

    assigned_agent_id uuid
        references agents(id)
        on delete set null,

    title text not null,

    description text not null,

    status text not null default 'pending'
        check (
            status in (
                'pending',
                'ready',
                'running',
                'waiting',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    depends_on jsonb not null default '[]'::jsonb,

    result jsonb,

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    started_at timestamptz,

    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists tasks_work_idx
    on tasks(work_id);

create index if not exists tasks_parent_idx
    on tasks(parent_task_id);

create index if not exists tasks_agent_idx
    on tasks(assigned_agent_id);

create index if not exists tasks_status_idx
    on tasks(status);