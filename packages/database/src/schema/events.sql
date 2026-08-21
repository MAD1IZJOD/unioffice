create table if not exists events (
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

    agent_id uuid
        references agents(id)
        on delete set null,

    actor_type text not null
        check (actor_type in ('user', 'agent', 'system')),

    actor_id uuid,

    type text not null,

    timestamp timestamptz not null default now(),

    payload jsonb not null default '{}'::jsonb,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists events_organization_idx
    on events(organization_id);

create index if not exists events_work_idx
    on events(work_id);

create index if not exists events_task_idx
    on events(task_id);

create index if not exists events_agent_idx
    on events(agent_id);

create index if not exists events_type_idx
    on events(type);

create index if not exists events_timestamp_idx
    on events(timestamp desc);