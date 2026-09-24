-- A schedule stops itself when the person it runs for loses access.
--
-- Every run is requested in the owner's name. If the owner is suspended,
-- removed, or no longer allowed to start missions in the mission's workspace,
-- the schedule must not go on acting under a permission they no longer hold.
-- The scheduler checks this each time an occurrence comes due and pauses the
-- mission with this reason instead of starting a run.
--
-- Widens an enumerated check; no existing row changes.

alter table continuous_missions drop constraint if exists continuous_missions_pause_reason_check;

alter table continuous_missions
    add constraint continuous_missions_pause_reason_check
    check (pause_reason in ('person', 'repeated_failures', 'owner_access'));
