-- When a rule applies, and who last changed it.
--
-- A policy could say who and what it covered - agents, tools, workspaces,
-- capabilities, kinds of knowledge - but not the circumstances. Once missions
-- run on a schedule with nobody watching, two circumstances matter:
--
--   startedBy         'schedule' or 'person': who started the mission.
--   writesExternally  true or false: whether the step, or the tool call,
--                     changes something outside the company.
--
-- Both are facts the server establishes for itself, never a model's claim.
-- An empty object means the rule is not narrowed by circumstance, which is
-- what every rule written before this reads as.
--
-- updated_by closes a gap in the trail: a rule's author was recorded, but
-- not whoever changed it afterwards.
--
-- Additive only. No existing row changes meaning.

alter table policies
    add column if not exists conditions jsonb not null default '{}'::jsonb;

alter table policies
    add column if not exists updated_by text;

-- Only the conditions the engine understands, with the values it understands.
-- A misspelt key would otherwise be stored, shown as a condition, and never
-- applied - a rule that looks narrower than it is.
alter table policies drop constraint if exists policies_conditions_check;

alter table policies
    add constraint policies_conditions_check
    check (
        jsonb_typeof(conditions) = 'object'
        and (conditions - 'startedBy' - 'writesExternally') = '{}'::jsonb
        and (
            not (conditions ? 'startedBy')
            or conditions->>'startedBy' in ('schedule', 'person')
        )
        and (
            not (conditions ? 'writesExternally')
            or jsonb_typeof(conditions->'writesExternally') = 'boolean'
        )
    );

-- The engine never lets a condition reach knowledge, so a conditioned
-- knowledge rule would look enforced and never apply. Refused here as well as
-- in the service, so no path can store one.
alter table policies drop constraint if exists policies_conditions_subject_check;

alter table policies
    add constraint policies_conditions_subject_check
    check (
        subject in ('tool', 'task')
        or conditions = '{}'::jsonb
    );
