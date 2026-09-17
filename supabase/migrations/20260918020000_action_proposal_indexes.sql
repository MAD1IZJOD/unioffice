-- Indexes for the two foreign keys on action_proposals.
--
-- Every mission's proposals are read together when its room is opened, and a
-- deleted agent has to be found by the database to be unlinked. Both are
-- covered by the house rule that a foreign key is indexed; the posture check
-- names them until they are.

create index if not exists action_proposals_work_idx
    on action_proposals(work_id, created_at desc);

create index if not exists action_proposals_agent_idx
    on action_proposals(agent_id) where agent_id is not null;
