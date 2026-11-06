-- The terminal recovery transition and its mission record commit together.
create or replace function public.fail_expired_execution_job(
    p_job_id uuid,
    p_attempts integer,
    p_observed_lease timestamptz,
    p_cutoff timestamptz,
    p_error text
)
returns setof public.execution_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
    failed_job public.execution_jobs%rowtype;
    interrupted_tasks integer;
begin
    update public.execution_jobs
       set status = 'failed',
           lease_expires_at = null,
           completed_at = p_cutoff,
           updated_at = p_cutoff,
           last_error = p_error
     where id = p_job_id
       and status = 'running'
       and attempts = p_attempts
       and attempts >= max_attempts
       and lease_expires_at = p_observed_lease
       and lease_expires_at < p_cutoff
    returning * into failed_job;

    if not found then return; end if;

    update public.works
       set status = 'failed',
           completed_at = p_cutoff,
           updated_at = p_cutoff,
           metadata = metadata || jsonb_build_object('executionError', p_error)
     where id = failed_job.work_id
       and organization_id = failed_job.organization_id
       and status in ('queued', 'planning', 'executing');

    if found then
        update public.tasks
           set status = 'failed',
               completed_at = p_cutoff,
               updated_at = p_cutoff,
               metadata = metadata || jsonb_build_object('execution', jsonb_build_object(
                   'status', 'failed',
                   'error', jsonb_build_object('code', 'EXECUTION_INTERRUPTED', 'message', p_error)
               ))
         where work_id = failed_job.work_id
           and status in ('ready', 'running');
        get diagnostics interrupted_tasks = row_count;

        insert into public.events (id, organization_id, work_id, actor_type, type, timestamp, payload)
        values (gen_random_uuid(), failed_job.organization_id, failed_job.work_id, 'system',
                'work.failed', p_cutoff, jsonb_build_object(
                    'stage', 'execution', 'reason', p_error,
                    'jobId', p_job_id, 'attempts', p_attempts,
                    'interruptedTaskCount', interrupted_tasks
                ));
    end if;

    return next failed_job;
end;
$$;

revoke all on function public.fail_expired_execution_job(uuid, integer, timestamptz, timestamptz, text)
    from public, anon, authenticated;
grant execute on function public.fail_expired_execution_job(uuid, integer, timestamptz, timestamptz, text)
    to service_role;
