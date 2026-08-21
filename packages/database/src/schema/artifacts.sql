create table if not exists artifacts (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid
        references works(id)
        on delete set null,

    task_id uuid
        references tasks(id)
        on delete set null,

    created_by_agent_id uuid
        references agents(id)
        on delete set null,

    name text not null,

    type text not null
        check (
            type in (
                'document',
                'spreadsheet',
                'presentation',
                'code',
                'dataset',
                'image',
                'analysis',
                'structured_data',
                'other'
            )
        ),

    description text,

    uri text,

    mime_type text,

    version integer not null default 1
        check (version > 0),

    created_at timestamptz not null default now(),

    updated_at timestamptz not null default now(),

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists artifacts_organization_idx
    on artifacts(organization_id);

create index if not exists artifacts_work_idx
    on artifacts(work_id);

create index if not exists artifacts_task_idx
    on artifacts(task_id);

create index if not exists artifacts_agent_idx
    on artifacts(created_by_agent_id);

create index if not exists artifacts_type_idx
    on artifacts(type);