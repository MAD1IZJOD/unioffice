-- Governance over company knowledge.
--
-- Knowledge is a new way for information to reach an agent, which makes it a
-- new way around the rules if governance cannot see it. Rather than building a
-- second permission system for the Brain, knowledge becomes two more subjects
-- the existing policy engine decides about:
--
--   knowledge_recall   may this agent be handed this knowledge? allow or deny.
--   knowledge_capture  what happens to knowledge extraction proposes?
--                      allow (recorded as active), require_approval (recorded
--                      as a proposal for a person to review), deny (discarded).
--
-- knowledge_types narrows a policy to kinds of knowledge - "never recall
-- assumptions into the finance workspace" - the same way tool_ids narrows a
-- tool policy. Empty means every type, matching every other scope column.

alter table policies drop constraint if exists policies_subject_check;

alter table policies
    add constraint policies_subject_check
    check (subject in ('tool', 'task', 'knowledge_recall', 'knowledge_capture'));

alter table policies
    add column if not exists knowledge_types text[] not null default '{}';

alter table policies drop constraint if exists policies_knowledge_types_check;

alter table policies
    add constraint policies_knowledge_types_check
    check (
        knowledge_types <@ array[
            'fact', 'decision', 'insight', 'policy', 'process',
            'preference', 'lesson', 'assumption', 'reference', 'experience'
        ]::text[]
    );

-- A knowledge policy scoped by tool, or a tool policy scoped by knowledge
-- type, is a contradiction the engine would silently never match. Refusing it
-- in the schema means no path - not the API, not a script - can store one.
alter table policies drop constraint if exists policies_scope_subject_check;

alter table policies
    add constraint policies_scope_subject_check
    check (
        (subject in ('tool', 'task') and cardinality(knowledge_types) = 0)
        or (subject in ('knowledge_recall', 'knowledge_capture') and cardinality(tool_ids) = 0)
    );

-- Recall is decided per item at the moment an agent would receive it; there
-- is no one to ask. Like a tool call, it can only be allowed or denied.
alter table policies drop constraint if exists policies_recall_effect_check;

alter table policies
    add constraint policies_recall_effect_check
    check (subject <> 'knowledge_recall' or effect in ('allow', 'deny'));
