create table if not exists works (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    workspace_id uuid
        references workspaces(id)
        on delete set null,

    requester_id uuid,

    objective text not null,

    status text not null default 'queued'
        check (
            status in (
                'queued',
                'planning',
                'executing',
                'waiting_approval',
                'completed',
                'failed',
                'cancelled'
            )
        ),

    priority text not null default 'normal'
        check (
            priority in (
                'low',
                'normal',
                'high',
                'critical'
            )
        ),

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    started_at timestamptz,

    completed_at timestamptz,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists works_organization_idx
    on works(organization_id);

create index if not exists works_workspace_idx
    on works(workspace_id);

create index if not exists works_status_idx
    on works(status);

create index if not exists works_priority_idx
    on works(priority);

create index if not exists works_created_at_idx
    on works(created_at desc);