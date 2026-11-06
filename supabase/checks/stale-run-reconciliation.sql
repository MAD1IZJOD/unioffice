-- Run against an isolated database with the migrations applied.
begin;

do $$
declare
    org_id uuid := gen_random_uuid();
    live_work uuid := gen_random_uuid();
    expired_work uuid := gen_random_uuid();
    scheduled_work uuid := gen_random_uuid();
    fresh_work uuid := gen_random_uuid();
    abandoned_work uuid := gen_random_uuid();
    abandoned_plan uuid := gen_random_uuid();
    detected timestamptz := '2026-11-06 06:30:00+00';
    cutoff timestamptz := detected - interval '15 minutes';
    recovered record;
begin
    insert into public.organizations (id, name, slug) values (org_id, 'Recovery test', 'recovery-' || org_id);

    insert into public.works (id, organization_id, objective, status, updated_at)
    select id, org_id, 'Recovery fixture', status, updated_at
    from (values
        (live_work, 'executing', cutoff),
        (expired_work, 'executing', cutoff),
        (scheduled_work, 'planning', cutoff),
        (fresh_work, 'executing', detected),
        (abandoned_work, 'executing', cutoff),
        (abandoned_plan, 'planning', cutoff)
    ) as fixture(id, status, updated_at);

    insert into public.execution_jobs (id, organization_id, work_id, status, lease_expires_at)
    values (gen_random_uuid(), org_id, live_work, 'running', detected + interval '1 minute'),
           (gen_random_uuid(), org_id, expired_work, 'running', cutoff),
           (gen_random_uuid(), org_id, scheduled_work, 'queued', null);

    if exists (select 1 from public.reconcile_abandoned_work(live_work, 'executing', cutoff, detected))
       or exists (select 1 from public.reconcile_abandoned_work(expired_work, 'executing', cutoff, detected))
       or exists (select 1 from public.reconcile_abandoned_work(scheduled_work, 'planning', cutoff, detected))
       or exists (select 1 from public.reconcile_abandoned_work(fresh_work, 'executing', cutoff, detected))
       or exists (select 1 from public.reconcile_abandoned_work(abandoned_plan, 'executing', cutoff, detected)) then
        raise exception 'Startup claimed work owned by the queue, recently updated, or changed since inspection';
    end if;

    insert into public.tasks (id, work_id, title, description, status, result)
    values (gen_random_uuid(), abandoned_work, 'Running', 'Fixture', 'running', null),
           (gen_random_uuid(), abandoned_work, 'Ready', 'Fixture', 'ready', null),
           (gen_random_uuid(), abandoned_work, 'Pending', 'Fixture', 'pending', null),
           (gen_random_uuid(), abandoned_work, 'Completed', 'Fixture', 'completed', '"durable"'::jsonb);

    select * into recovered from public.reconcile_abandoned_work(abandoned_work, 'executing', cutoff, detected);
    if not found or recovered.work ->> 'status' <> 'failed' or recovered.interrupted_task_count <> 2 then
        raise exception 'Startup did not close the abandoned mission and interrupted tasks';
    end if;
    if (select count(*) from public.tasks where work_id = abandoned_work and status = 'failed') <> 2
       or not exists (select 1 from public.tasks where work_id = abandoned_work and status = 'pending')
       or not exists (select 1 from public.tasks where work_id = abandoned_work and status = 'completed' and result = '"durable"'::jsonb) then
        raise exception 'Startup changed tasks outside the interrupted states';
    end if;

    if exists (select 1 from public.reconcile_abandoned_work(abandoned_work, 'executing', cutoff, detected))
       or (select count(*) from public.events where organization_id = org_id and type = 'work.failed') <> 1 then
        raise exception 'Startup reconciliation was not idempotent';
    end if;

    select * into recovered from public.reconcile_abandoned_work(abandoned_plan, 'planning', cutoff, detected);
    if not found or not (recovered.work -> 'metadata' ? 'planningError') then
        raise exception 'An abandoned plan lost its planning failure reason';
    end if;
end;
$$;

rollback;
