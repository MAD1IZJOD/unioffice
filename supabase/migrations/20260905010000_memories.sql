create table if not exists memories (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    agent_id uuid
        references agents(id)
        on delete set null,

    work_id uuid
        references works(id)
        on delete set null,

    task_id uuid
        references tasks(id)
        on delete set null,

    scope text not null
        check (scope in ('company', 'agent')),

    type text not null
        check (type in ('fact', 'decision', 'preference', 'instruction', 'experience', 'document')),

    content text not null,
    source text,

    importance real not null default 0.5
        check (importance >= 0 and importance <= 1),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists memories_organization_created_idx
    on memories(organization_id, created_at desc);

create index if not exists memories_agent_idx
    on memories(agent_id);
