create table if not exists workflows (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid not null
        references works(id)
        on delete cascade,

    name text not null,

    description text,

    status text not null default 'draft'
        check (
            status in (
                'draft',
                'ready',
                'running',
                'paused',
                'waiting',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    started_at timestamptz,

    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists workflows_organization_idx
    on workflows(organization_id);

create index if not exists workflows_work_idx
    on workflows(work_id);

create index if not exists workflows_status_idx
    on workflows(status);