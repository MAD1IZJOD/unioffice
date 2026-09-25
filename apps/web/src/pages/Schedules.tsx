import { CalendarClock, Plus, X } from "lucide-react";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createContinuousMission,
  fetchContinuousMissions,
  fetchWorkspaces,
  type ContinuousMissionItem,
  type ScheduleCadence,
  type WorkspaceSummary,
} from "../lib/api";
import { useAccess, useCan } from "../lib/access";
import {
  CADENCE_LABEL,
  DAY_NAMES,
  formatExact,
  formatWhen,
  knownTimezones,
  localTimezone,
  RUN_STATE_LABEL,
  runTitle,
  runTone,
  scheduleFrom,
  scheduleStanding,
} from "../lib/schedules";
import { toneClass } from "../lib/tone";
import { useResource } from "../lib/useResource";

import {
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StaleNotice,
  StatusPill,
} from "../components/primitives";

/**
 * Work the company does on its own, on a schedule.
 *
 * Each entry is a standing instruction; each time it comes due it starts an
 * ordinary mission - planned, governed, approved and executed like any other
 * - and this page is where a person sees what is scheduled, how the last run
 * went and when the next one is.
 */
export default function Schedules() {
  const canCreate = useCan("missions.create");
  const missions = useResource<ContinuousMissionItem[]>(
    useCallback(() => fetchContinuousMissions(), []),
    { pollMs: 60_000 },
  );

  const [creating, setCreating] = useState(false);

  if (missions.error && !missions.data) {
    return (
      <div className="mx-auto max-w-[1240px] pt-6">
        <Failure
          headline={missions.error.status === 0 ? "UNIOFFICE can't reach its server" : "UNIOFFICE couldn't load the schedules"}
          detail={missions.error.message}
          consequence="Nothing was changed. Schedules keep running on the server whether or not this page can read them."
          action={<button type="button" className="button-ghost" onClick={missions.reload}>Try again</button>}
        />
      </div>
    );
  }

  const all = missions.data ?? [];
  const running = all.filter((mission) => mission.status === "active");
  const stopped = all.filter((mission) => mission.status === "paused" && mission.pauseReason !== "person");
  const next = running
    .map((mission) => mission.nextRunAt)
    .filter((when): when is string => Boolean(when))
    .sort()[0];

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Work"
        title="SCHEDULES"
        lead={missions.loading ? "READING…" : `${running.length} RUNNING ON THEIR OWN.`}
        detail="A schedule starts the same mission again and again. Every run is planned, held to the company's rules and stopped for a person wherever one is needed - exactly like a mission started by hand."
        tone={stopped.length > 0 ? "broken" : "quiet"}
        action={canCreate && !creating ? (
          <button type="button" className="button-primary" onClick={() => setCreating(true)}>
            <Plus size={12} />
            New schedule
          </button>
        ) : undefined}
        meta={
          <>
            <Reading label="On schedule" value={missions.loading ? "—" : running.length} tone="live" />
            <Reading label="Stopped themselves" value={missions.loading ? "—" : stopped.length} tone={stopped.length > 0 ? "error" : "idle"} />
            <Reading label="Next run" value={missions.loading ? "—" : next ? formatWhen(next) : "None"} tone="active" />
          </>
        }
      />

      <div className="mx-auto max-w-[1240px]">
        {missions.error && missions.data && <StaleNotice error={missions.error} onRetry={missions.reload} />}

        {creating && (
          <ScheduleCreator
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              missions.reload();
            }}
          />
        )}

        {missions.loading ? (
          <Connecting what="Reading the schedules…" />
        ) : all.length === 0 ? (
          <Quiet
            line="Nothing runs on a schedule yet."
            detail={canCreate
              ? "Give UNIOFFICE something to do every day, every weekday or every week - a report, a check, a watch on something that changes."
              : "Someone who can start missions can set one up."}
          />
        ) : (
          <div className="schedule-list" role="list" aria-label="Schedules">
            {all.map((mission) => <ScheduleRow key={mission.id} mission={mission} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleRow({ mission }: { mission: ContinuousMissionItem }) {
  const standing = scheduleStanding(mission);
  const latest = mission.latestRun;

  return (
    <Link
      to={`/schedules/${mission.id}`}
      className={`schedule-row ${toneClass[standing.tone]}`}
      role="listitem"
      aria-label={mission.name}
    >
      <span className="min-w-0">
        <span className="schedule-name">{mission.name}</span>
        <span className="schedule-cadence">{mission.cadence}</span>
        <span className="schedule-objective">{mission.objective}</span>
        {mission.pauseNote && <span className="schedule-note">{mission.pauseNote}</span>}
      </span>

      <span className="schedule-meta">
        <StatusPill tone={standing.tone}>{standing.label}</StatusPill>
        {mission.status === "active" && mission.nextRunAt && (
          <span className="schedule-next" title={formatExact(mission.nextRunAt)}>Next run {formatWhen(mission.nextRunAt)}</span>
        )}
        {latest ? (
          <span className="t-meta">
            {runTitle(latest)}: <span className={`schedule-run-state ${toneClass[runTone(latest.state)]}`}>{RUN_STATE_LABEL[latest.state]}</span>
          </span>
        ) : (
          <span className="t-meta">No runs yet</span>
        )}
      </span>
    </Link>
  );
}

/* --------------------------------------------------------------------------
   Setting one up
   -------------------------------------------------------------------------- */

function ScheduleCreator({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const access = useAccess();
  const workspaces = useResource<WorkspaceSummary[]>(useCallback(() => fetchWorkspaces(), []));
  const timezones = useMemo(() => knownTimezones(), []);

  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [briefing, setBriefing] = useState("");
  const [cadence, setCadence] = useState<ScheduleCadence>("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [time, setTime] = useState("09:00");
  const [minuteOfHour, setMinuteOfHour] = useState(0);
  const [timezone, setTimezone] = useState(localTimezone());
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Only workspaces this person may start missions in: filing a schedule
  // anywhere else would be refused by the server, so it is not offered.
  const filable = (workspaces.data ?? [])
    .map((entry) => entry.workspace)
    .filter((workspace) => workspace.status === "active")
    .filter((workspace) => !access || access.canActIn("missions.create", workspace.id));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    try {
      const created = await createContinuousMission({
        name: name.trim(),
        objective: objective.trim(),
        briefing: briefing.trim() || undefined,
        workspaceId: workspaceId || undefined,
        schedule: scheduleFrom({ cadence, dayOfWeek, time, minuteOfHour, timezone }),
      });

      onCreated();
      navigate(`/schedules/${created.id}`);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="schedule-creator" onSubmit={(event) => void submit(event)} aria-label="New schedule">
      <div className="schedule-creator-head">
        <CalendarClock size={14} />
        <span className="t-eyebrow">New schedule</span>
        <button type="button" className="button-quiet ml-auto" onClick={onCancel} aria-label="Close without saving">
          <X size={12} />
        </button>
      </div>

      <label className="schedule-field">
        <span className="schedule-label">What to call it</span>
        <input className="config-input" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Competitor pricing watch" />
      </label>

      <label className="schedule-field">
        <span className="schedule-label">What each run should do</span>
        <textarea className="config-textarea" required minLength={4} maxLength={4000} rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Check our three main competitors' pricing pages and tell me if anything material changed since last week." />
      </label>

      <label className="schedule-field">
        <span className="schedule-label">Anything every run should keep to <span className="t-meta">(optional)</span></span>
        <textarea className="config-textarea" maxLength={4000} rows={2} value={briefing} onChange={(event) => setBriefing(event.target.value)} placeholder="Only report changes over 5%. Never contact the competitors." />
      </label>

      <div className="schedule-when">
        <label className="schedule-field">
          <span className="schedule-label">How often</span>
          <select className="config-input" value={cadence} onChange={(event) => setCadence(event.target.value as ScheduleCadence)}>
            {(Object.keys(CADENCE_LABEL) as ScheduleCadence[]).map((entry) => (
              <option key={entry} value={entry}>{CADENCE_LABEL[entry]}</option>
            ))}
          </select>
        </label>

        {cadence === "weekly" && (
          <label className="schedule-field">
            <span className="schedule-label">On</span>
            <select className="config-input" value={dayOfWeek} onChange={(event) => setDayOfWeek(Number(event.target.value))}>
              {DAY_NAMES.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select>
          </label>
        )}

        {cadence === "hourly" ? (
          <label className="schedule-field">
            <span className="schedule-label">Minutes past the hour</span>
            <input className="config-input" type="number" min={0} max={59} required value={minuteOfHour} onChange={(event) => setMinuteOfHour(Number(event.target.value))} />
          </label>
        ) : (
          <label className="schedule-field">
            <span className="schedule-label">At</span>
            <input className="config-input" type="time" required value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
        )}

        <label className="schedule-field">
          <span className="schedule-label">Timezone</span>
          <select className="config-input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {timezones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </select>
        </label>
      </div>

      {filable.length > 0 && (
        <label className="schedule-field">
          <span className="schedule-label">Workspace</span>
          <select className="config-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>
            <option value="">Company-wide</option>
            {filable.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
      )}

      <p className="config-hint">
        Each run is a mission in your name. If you later lose access here, the schedule stops itself rather than go on without you.
        Company rules about work nobody is watching apply to every scheduled run.
      </p>

      {error && <Failure headline="The schedule was not set up" detail={error} />}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="button-primary" disabled={busy || !name.trim() || objective.trim().length < 4}>
          {busy ? "Setting it up…" : "Start the schedule"}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}
