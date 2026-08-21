create table if not exists workflow_nodes (
    id uuid primary key,

    workflow_id uuid not null
        references workflows(id)
        on delete cascade,

    type text not null
        check (type in ('task', 'approval', 'condition')),

    name text not null,

    task_id uuid
        references tasks(id)
        on delete set null,

    depends_on jsonb not null default '[]'::jsonb,

    metadata jsonb not null default '{}'::jsonb
);

create index if not exists workflow_nodes_workflow_idx
    on workflow_nodes(workflow_id);

create index if not exists workflow_nodes_task_idx
    on workflow_nodes(task_id);

create index if not exists workflow_nodes_type_idx
    on workflow_nodes(type);