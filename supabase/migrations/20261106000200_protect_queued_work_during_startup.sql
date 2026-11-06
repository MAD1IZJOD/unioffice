-- Startup may close abandoned work only when the durable queue does not own it.
create or replace function public.reconcile_abandoned_work(
    p_work_id uuid,
    p_status text,
    p_cutoff timestamptz,
    p_detected_at timestamptz
)
returns table (work jsonb, interrupted_task_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    candidate public.works%rowtype;
    interrupted_count integer;
    stage text := case when p_status = 'planning' then 'planning' else 'execution' end;
    reason text := 'Interrupted by an API restart. Retry to resume from where it stopped.';
begin
    -- The work row lock serializes with a new job's work_id foreign-key check.
    -- Recheck age, status and queue ownership here, after the candidate read.
    select * into candidate
      from public.works
     where id = p_work_id
       and status in ('planning', 'executing')
       and status = p_status
       and updated_at <= p_cutoff
     for update;

    if not found or exists (
        select 1 from public.execution_jobs
         where work_id = p_work_id and status in ('queued', 'running')
    ) then
        return;
    end if;

    update public.tasks
       set status = 'failed',
           completed_at = p_detected_at,
           updated_at = p_detected_at,
           metadata = metadata || jsonb_build_object('execution', jsonb_build_object(
               'status', 'failed',
               'error', jsonb_build_object('code', 'EXECUTION_INTERRUPTED', 'message', reason)
           ))
     where work_id = p_work_id
       and status in ('ready', 'running');
    get diagnostics interrupted_count = row_count;

    update public.works
       set status = 'failed',
           completed_at = p_detected_at,
           updated_at = p_detected_at,
           metadata = metadata || jsonb_build_object(
               stage || 'Error', reason,
               'interrupted', jsonb_build_object('detectedAt', p_detected_at, 'taskCount', interrupted_count)
           )
     where id = p_work_id
    returning * into candidate;

    insert into public.events (id, organization_id, work_id, actor_type, type, timestamp, payload)
    values (gen_random_uuid(), candidate.organization_id, p_work_id, 'system', 'work.failed',
            p_detected_at, jsonb_build_object('stage', stage, 'reason', reason, 'interruptedTaskCount', interrupted_count));

    return query select to_jsonb(candidate), interrupted_count;
end;
$$;

revoke all on function public.reconcile_abandoned_work(uuid, text, timestamptz, timestamptz)
    from public, anon, authenticated;
grant execute on function public.reconcile_abandoned_work(uuid, text, timestamptz, timestamptz)
    to service_role;
