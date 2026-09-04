create table if not exists approval_requests (
    id uuid primary key,

    organization_id uuid not null
        references organizations(id)
        on delete cascade,

    work_id uuid not null
        references works(id)
        on delete cascade,

    task_id uuid not null
        references tasks(id)
        on delete cascade,

    agent_id uuid
        references agents(id)
        on delete set null,

    action text not null,
    resource text not null,
    reason text not null,

    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'expired', 'cancelled')),

    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by uuid,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists approval_requests_organization_status_idx
    on approval_requests(organization_id, status, created_at);

create index if not exists approval_requests_work_idx
    on approval_requests(work_id, created_at);

create unique index if not exists approval_requests_pending_task_idx
    on approval_requests(task_id)
    where status = 'pending';
