-- Serialize each worker write with recovery of its execution_jobs row.
-- Ordinary API requests and SQL maintenance have no worker claim headers.
create or replace function public.assert_execution_job_claim()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
begin
    perform 1
      from public.execution_jobs
     where id = (headers ->> 'x-unioffice-job-id')::uuid
       and attempts = (headers ->> 'x-unioffice-job-attempt')::integer
       and claimed_by = headers ->> 'x-unioffice-job-worker'
       and status = 'running'
     for share;

    if not found then
        raise sqlstate 'PT409' using message = 'execution_job_claim_lost';
    end if;
end;
$$;

revoke all on function public.assert_execution_job_claim() from public, anon, authenticated;
grant execute on function public.assert_execution_job_claim() to service_role;

create or replace function public.guard_execution_attempt_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if nullif(current_setting('request.headers', true), '')::jsonb ? 'x-unioffice-job-id' then
        perform public.assert_execution_job_claim();
    end if;
    return null;
end;
$$;

revoke all on function public.guard_execution_attempt_write() from public, anon, authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'works', 'tasks', 'artifacts', 'events', 'approval_requests', 'action_proposals',
        'memories', 'knowledge_recalls', 'knowledge_conflicts', 'connections', 'skill_versions'
    ] loop
        execute format('drop trigger if exists guard_execution_attempt_write on public.%I', table_name);
        execute format(
            'create trigger guard_execution_attempt_write before insert or update or delete on public.%I
             for each statement execute function public.guard_execution_attempt_write()',
            table_name
        );
    end loop;
end;
$$;
