import { ArrowLeft, ArrowRight, Pause, Play, Square, Zap } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  changeContinuousMission,
  fetchContinuousMission,
  runContinuousMissionNow,
  type ContinuousMissionDetail,
  type ContinuousMissionRunSummary,
} from "../lib/api";
import { useCan } from "../lib/access";
import {
  formatExact,
  formatWhen,
  RUN_STATE_LABEL,
  runTitle,
  runTone,
  scheduleStanding,
} from "../lib/schedules";
import { toneClass } from "../lib/tone";
import { useResource } from "../lib/useResource";

import { Connecting, Failure, Quiet, StaleNotice, StatusPill } from "../components/primitives";

/**
 * One continuous mission: what it does, when, how its runs went, and the
 * controls a person is allowed to use on it.
 */
export default function Schedule() {
  const { scheduleId = "" } = useParams();
  const navigate = useNavigate();

  const schedule = useResource<ContinuousMissionDetail>(
    useCallback(() => fetchContinuousMission(scheduleId), [scheduleId]),
    { enabled: Boolean(scheduleId), pollMs: 30_000 },
  );

  // Operating it is allowed where the person may operate missions: the same
  // rule the server applies when the button is pressed.
  const canOperate = useCan("missions.operate", schedule.data?.workspaceId ?? null);

  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (schedule.loading) {
    return <div className="mx-auto max-w-[1240px]"><Connecting what="Opening the schedule…" /></div>;
  }

  if (!schedule.data) {
    const missing = schedule.error?.status === 404;

    return (
      <div className="mx-auto max-w-[1240px] pt-4">
        <Failure
          headline={missing ? "This schedule is not here" : "UNIOFFICE couldn't open this schedule"}
          detail={missing
            ? "No schedule with this reference exists for this company, or it belongs to a workspace you have not been given."
            : (schedule.error?.message ?? "The API returned nothing for this schedule.")}
          action={
            <>
              {!missing && <button type="button" className="button-ghost" onClick={schedule.reload}>Try again</button>}
              <Link to="/schedules" className="button-quiet">Schedules</Link>
            </>
          }
        />
      </div>
    );
  }

  const current = schedule.data;
  const standing = scheduleStanding(current);
  const latest = current.runs[0];
  const runInFlight = latest !== undefined && (latest.state === "running" || latest.state === "waiting_for_approval");

  async function act(label: string, change: () => Promise<unknown>) {
    setBusy(label);
    setError(undefined);

    try {
      await change();
      setConfirmingCancel(false);
      schedule.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="fade-up">
      <header className={`place ${toneClass[standing.tone]}`}>
        <div className="place-inner">
          <Link to="/schedules" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            Schedules
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <h2 className="place-name">{current.name}</h2>
            <StatusPill tone={standing.tone}>{standing.label}</StatusPill>
          </div>

          <p className="place-description">{current.objective}</p>

          <div className="place-slug">
            {current.cadence}
            {current.status === "active" && current.nextRunAt && (
              <span title={formatExact(current.nextRunAt)}> · next run {formatWhen(current.nextRunAt)}</span>
            )}
            {current.ownedByYou ? " · runs in your name" : ""}
          </div>

          {current.pauseNote && (
            <div className="mt-5 max-w-[72ch]">
              <Failure
                headline="It stopped itself"
                detail={current.pauseNote}
                consequence="Nothing more runs until someone resumes it."
              />
            </div>
          )}

          {canOperate && current.status !== "cancelled" && (
            <div className="mt-7 flex flex-wrap items-center gap-2">
              {current.status === "active" && (
                <button type="button" className="button-ghost" disabled={Boolean(busy)} onClick={() => void act("pause", () => changeContinuousMission(current.id, "pause"))}>
                  <Pause size={12} />
                  {busy === "pause" ? "Pausing…" : "Pause"}
                </button>
              )}
              {current.status === "paused" && (
                <button type="button" className="button-primary" disabled={Boolean(busy)} onClick={() => void act("resume", () => changeContinuousMission(current.id, "resume"))}>
                  <Play size={12} />
                  {busy === "resume" ? "Resuming…" : "Resume"}
                </button>
              )}
              <button
                type="button"
                className="button-ghost"
                disabled={Boolean(busy) || runInFlight}
                title={runInFlight ? "One run at a time: the last one has not finished." : undefined}
                onClick={() => void act("run", async () => {
                  const run = await runContinuousMissionNow(current.id);
                  navigate(`/missions/${run.workId}`);
                })}
              >
                <Zap size={12} />
                {busy === "run" ? "Starting…" : "Run now"}
              </button>
              {confirmingCancel ? (
                <span className="schedule-confirm" role="group" aria-label="Confirm cancelling the schedule">
                  <span className="t-meta">Stop it for good? Its runs stay on record.</span>
                  <button type="button" className="button-reject" disabled={Boolean(busy)} onClick={() => void act("cancel", () => changeContinuousMission(current.id, "cancel"))}>
                    {busy === "cancel" ? "Cancelling…" : "Cancel the schedule"}
                  </button>
                  <button type="button" className="button-quiet" disabled={Boolean(busy)} onClick={() => setConfirmingCancel(false)}>Keep it</button>
                </span>
              ) : (
                <button type="button" className="button-quiet" disabled={Boolean(busy)} onClick={() => setConfirmingCancel(true)}>
                  <Square size={12} />
                  Cancel…
                </button>
              )}
            </div>
          )}

          {runInFlight && canOperate && current.status !== "cancelled" && (
            <p className="config-hint mt-3 max-w-[68ch]">
              {runTitle(latest!)} is still {latest!.state === "waiting_for_approval" ? "waiting for a decision" : "running"}. Runs happen one at a time.
            </p>
          )}

          {error && (
            <div className="mt-4 max-w-[68ch]">
              <Failure headline="That change was not made" detail={error} />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1240px]">
        {schedule.error && <StaleNotice error={schedule.error} onRetry={schedule.reload} />}

        <div className="dossier">
          <div className="min-w-0">
            <section className="dossier-block" aria-label="Runs">
              <div className="dossier-question">How its runs went</div>

              {current.runs.length === 0 ? (
                <Quiet
                  line="It has not run yet."
                  detail={current.status === "active" && current.nextRunAt
                    ? `The first run starts ${formatWhen(current.nextRunAt)}, at ${formatExact(current.nextRunAt)}.`
                    : "It will run once it is resumed."}
                />
              ) : (
                <ol className="schedule-runs" aria-label="Run history">
                  {current.runs.map((run) => <RunRow key={run.sequence} run={run} />)}
                </ol>
              )}

              {current.skipped > 0 && (
                <p className="dossier-answer">
                  {current.skipped} {current.skipped === 1 ? "time it was due" : "times it was due"}, the run before was still going,
                  so that occurrence was skipped rather than stacked up behind it.
                </p>
              )}
            </section>
          </div>

          <aside className="min-w-0">
            <section className="dossier-block" aria-label="What each run does">
              <div className="dossier-question">What each run is asked</div>
              <p className="schedule-prose">{current.objective}</p>
              {current.briefing && (
                <>
                  <div className="dossier-question mt-4">What every run keeps to</div>
                  <p className="schedule-prose">{current.briefing}</p>
                </>
              )}
              <p className="dossier-answer">
                Every run is planned afresh, routed to the agents set up for it, held to the company's rules - including any
                about work nobody is watching - and stopped for a person wherever one is needed.
              </p>
            </section>

            <details className="tech-detail">
              <summary>Technical details</summary>
              <dl className="schedule-technical">
                <dt>Schedule</dt>
                <dd>{current.id}</dd>
                <dt>Timezone</dt>
                <dd>{current.schedule.timezone}</dd>
                <dt>Runs started</dt>
                <dd>{current.runCount}</dd>
                {current.lastRunAt && (
                  <>
                    <dt>Last started</dt>
                    <dd>{new Date(current.lastRunAt).toISOString()}</dd>
                  </>
                )}
                {current.nextRunAt && (
                  <>
                    <dt>Next due</dt>
                    <dd>{new Date(current.nextRunAt).toISOString()}</dd>
                  </>
                )}
              </dl>
            </details>
          </aside>
        </div>
      </div>
    </div>
  );
}

function RunRow({ run }: { run: ContinuousMissionRunSummary }) {
  const tone = runTone(run.state);

  return (
    <li className="schedule-run">
      <Link to={`/missions/${run.workId}`} className="schedule-run-link" aria-label={`${runTitle(run)}: ${RUN_STATE_LABEL[run.state]}`}>
        <span className="min-w-0">
          <span className="schedule-run-title">{runTitle(run)}</span>
          <span className="t-meta" title={formatExact(run.startedAt)}> · started {formatWhen(run.startedAt)}</span>
          {run.note && <span className="schedule-run-note">{run.note}</span>}
        </span>

        <span className="schedule-run-status">
          <StatusPill tone={tone} pulse={run.state === "running"}>{RUN_STATE_LABEL[run.state]}</StatusPill>
          <ArrowRight size={11} aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
