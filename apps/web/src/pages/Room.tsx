import {
  ArrowLeft,
  Ban,
  CalendarClock,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  cancelWork,
  executeWork,
  launchWork,
  fetchExecutionRoom,
  fetchMissionKnowledge,
  formatDuration,
  formatRelativeTime,
  planWork,
  resolveApproval,
  retryWork,
  type ArtifactItem,
  type ExecutionRoom as ExecutionRoomData,
  type MissionKnowledge,
} from "../lib/api";

import { kindLabel, knowledgeStatusLabel } from "../lib/knowledge";
import { runLinkOf } from "../lib/schedules";
import { MissionDebrief } from "../components/room/MissionDebrief";
import { useLiveResource } from "../lib/live";
import { useCan } from "../lib/access";
import { useResource } from "../lib/useResource";
import { excerptOf } from "../lib/events";

import {
  briefingOf,
  messageOf,
  narrateMission,
  readMission,
  type MissionState,
} from "../lib/mission";

import { missionDataOfRoom, roomResult } from "../lib/room";
import { summarizeGovernance } from "../lib/governance";

import { toneClass } from "../lib/tone";

import { Chapter, Chip, Connecting, Failure, Quiet, StatusPill } from "../components/primitives";

import { ArtifactSheet } from "../components/ArtifactSheet";
import { MissionRecord } from "../components/MissionRecord";
import {
  MissionHandoffs,
  MissionResultBrief,
  MissionTimeline,
} from "../components/room/MissionStory";
import { WorkspaceMark } from "../components/WorkspaceMark";

import { DecisionBand } from "../components/room/DecisionBand";
import { MissionGovernance } from "../components/room/MissionGovernance";
import { ExecutionFloor } from "../components/room/ExecutionFloor";
import { RoomCast } from "../components/room/RoomCast";

/**
 * The execution room.
 *
 * One mission, watched rather than reviewed. Everything on this page comes
 * from a single read the API assembles, kept current by the live channel - so
 * the objective, the plan's shape, who is holding what, the decision that
 * stopped it and the thing it produced are all describing the same instant.
 *
 * The order is deliberate and is the whole argument of the surface: what the
 * company is doing, what it needs from you, what it produced, and only then
 * the machinery that produced it. A person who opens this while it is running
 * wants the first two; a person who opens it afterwards wants the third.
 */

/** Used only when the live channel is unavailable. */
const FALLBACK_POLL_MS = 4_000;

export default function Room() {
  const { missionId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [action, setAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [openArtifact, setOpenArtifact] = useState<ArtifactItem>();
  const [focused, setFocused] = useState<string>();

  // The moment a mission finishes while someone is watching it. Decided from
  // the mission's own status changing under this page - from live to
  // delivered or stopped - and never from a mission that was already finished
  // when it was opened, which simply shows as finished. Adjusted during render,
  // React's documented way to respond to a value the component already has.
  const [lastStatus, setLastStatus] = useState<string>();
  const [finishedHere, setFinishedHere] = useState<"delivered" | "stopped">();
  const [objectiveOpen, setObjectiveOpen] = useState(false);

  const room = useLiveResource<ExecutionRoomData>(
    useCallback(() => fetchExecutionRoom(missionId), [missionId]),
    {
      workId: missionId,
      fallbackPollMs: FALLBACK_POLL_MS,
      enabled: Boolean(missionId),
    },
  );

  // What this mission was handed and what it taught the company. Knowledge is
  // recalled as steps start and captured as they finish, so it is re-read on a
  // modest interval while that can still happen. Once the mission has finished
  // it only changes through the debrief, which re-reads it after each decision -
  // and each read compares every open lesson against the Brain, which is not
  // worth repeating every few seconds for a mission nobody is running. It waits
  // for the room so the interval is decided once, not flipped after a first read.
  const finished =
    room.data?.work.status === "completed" ||
    room.data?.work.status === "failed" ||
    room.data?.work.status === "cancelled";
  const knowledge = useResource<MissionKnowledge>(
    useCallback(() => fetchMissionKnowledge(missionId), [missionId]),
    {
      pollMs: finished ? undefined : 15_000,
      enabled: Boolean(missionId) && Boolean(room.data),
    },
  );

  const { reload } = room;

  const status = room.data?.work.status;

  if (status !== lastStatus) {
    setLastStatus(status);

    const wasLive = lastStatus !== undefined && !["completed", "failed", "cancelled"].includes(lastStatus);

    if (wasLive && status === "completed") setFinishedHere("delivered");
    else if (wasLive && (status === "failed" || status === "cancelled")) setFinishedHere("stopped");
  }

  const run = useCallback(
    async (label: string, operation: () => Promise<unknown>) => {
      setAction(label);
      setActionError(undefined);

      try {
        await operation();
        reload();
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setAction(undefined);
      }
    },
    [reload],
  );

  // The controls that start, run and stop this mission are offered only to
  // someone who may operate it in its workspace. The server checks again
  // either way; this only avoids offering what would be refused.
  const canOperate = useCan("missions.operate", room.data?.work.workspaceId ?? null);

  // A mission opened from the composer starts itself: planned, then queued,
  // here - so the wait happens where the mission will keep happening and you
  // watch the plan being written. The ref makes it once-only under
  // StrictMode; the history entry is rewritten so a refresh does not replay
  // it.
  const started = useRef(false);
  const autostart = Boolean(
    (location.state as { autostart?: boolean } | null)?.autostart,
  );

  useEffect(() => {
    if (!autostart || started.current) return;
    started.current = true;

    navigate(location.pathname, { replace: true, state: null });

    // One request that answers at once. The server plans and queues the
    // mission itself, so leaving this page mid-plan changes nothing.
    void run("open", () => launchWork(missionId));
  }, [autostart, location.pathname, missionId, navigate, run]);

  if (room.loading) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <Connecting what="Opening the room…" />
      </div>
    );
  }

  if (room.error || !room.data) {
    return (
      <div className="mx-auto max-w-[1080px] pt-4">
        <Failure
          headline="This mission could not be opened"
          detail={room.error?.message ?? "The API returned nothing for this id."}
          consequence={
            room.error?.isOffline
              ? "The mission itself is unaffected — a worker runs it from the queue, not from this page."
              : undefined
          }
          action={
            <>
              <button type="button" onClick={room.reload} className="button-ghost">
                Try again
              </button>
              <Link to="/missions" className="button-quiet">
                Every mission
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const data = room.data;
  const { work, plan, approvals, artifacts, executionJob, workspace, narrative } = data;

  const review = knowledge.data?.review ?? [];
  const toDecide = review.filter((item) => item.outcome === "pending").length;
  const used = knowledge.data?.used.filter((entry) => !entry.fromThisMission) ?? [];

  const state = readMission(missionDataOfRoom(data));

  // A mission can finish running and still hand back a result with limits.
  // The header then says so in the same tone the result below uses, rather
  // than a green "delivered" sitting over a result that says otherwise.
  const limited = state.phase === "delivered" && narrative.outcome.status === "completed_with_limitations";
  const headerTone = limited ? "warning" : state.tone;
  const headerLabel = limited ? "Delivered with limits" : state.label;

  // A long objective is shown in its first lines until asked for in full, so
  // it names the mission without taking the whole first screen. Nothing is
  // cut from the text; the clamp is presentation only.
  const longObjective = work.objective.length > 110;
  const moments = narrateMission(data.events, {
    tasks: data.tasks,
    agents: data.agents,
    tools: data.tools,
  });

  const pending = approvals.filter((approval) => approval.status === "pending");
  const settled = approvals.filter((approval) => approval.status !== "pending");
  const result = roomResult(data);

  // Every chapter is conditional on the mission having got that far, so their
  // numbers are worked out from which ones are actually present rather than
  // written in. Computed, not counted during render - a counter incremented
  // mid-render is a different number on the next one.
  const chapters = [
    plan.totalCount > 0 ? "floor" : undefined,
    data.cast.length > 0 ? "cast" : undefined,
    narrative.handoffs.length > 0 ? "handoffs" : undefined,
    "timeline",
    settled.length > 0 ? "decisions" : undefined,
    artifacts.length > 0 || review.length > 0 || used.length > 0 ? "left" : undefined,
  ].filter((name): name is string => name !== undefined);

  const chapter = (name: string) => String(chapters.indexOf(name) + 1).padStart(2, "0");
  const failure = messageOf(work);
  const briefing = briefingOf(work);
  // When a schedule started this mission: which one, and which run it is.
  const scheduledRun = runLinkOf(work.metadata);
  const planner = data.orchestrator?.name;

  const agentName = (id?: string) =>
    data.agents.find((agent) => agent.id === id)?.name ?? "Unassigned";

  // A decision points at what it covers as "task:<uuid>" or, since approvals
  // bind to a written proposal, "proposal:<uuid>". Both are the right way to
  // store it and the wrong way to read it: an id tells a person nothing, so
  // the step is named, and when it cannot be named nothing is shown at all.
  const stepNamed = (resource: string, taskId?: string): string | undefined => {
    const fromResource = resource.startsWith("task:") ? resource.slice(5) : undefined;
    const id = fromResource ?? taskId;

    return id ? plan.nodes.find((node) => node.taskId === id)?.title : undefined;
  };

  // What the company's rules did to this mission, counted from its own log.
  const governance = summarizeGovernance(data.events);

  const busy = Boolean(action);
  const opening = action === "open";
  const toolCalls = plan.nodes.reduce(
    (total, node) => total + node.toolCallCount,
    0,
  );

  return (
    <div className="room fade-up">
      <header
        className={`operation ${toneClass[headerTone]} ${moodOf(state)}${finishedHere ? ` operation-settled operation-settled-${finishedHere}` : ""}`}
      >
        <div className="operation-inner">
          <Link to="/missions" className="button-quiet mb-7 inline-flex">
            <ArrowLeft size={12} />
            Every mission
          </Link>

          <div className="operation-eyebrow">
            <Pulse status={room.status} live={state.live} />
            <span>opened {formatRelativeTime(work.createdAt)}</span>
            <span>{work.priority} priority</span>

            {workspace && (
              <Link to={`/workspaces/${workspace.id}`} className="operation-place">
                <WorkspaceMark slug={workspace.slug} size={12} />
                {workspace.name}
              </Link>
            )}

            {scheduledRun && (
              <Link to={`/schedules/${scheduledRun.continuousMissionId}`} className="operation-place">
                <CalendarClock size={12} />
                Run {scheduledRun.sequence} of {scheduledRun.name}
              </Link>
            )}
          </div>

          <h2
            id="operation-objective"
            className={`operation-objective${longObjective ? " operation-objective-long" : ""}${
              longObjective && !objectiveOpen ? " operation-objective-clamped" : ""
            }`}
          >
            {work.objective}
          </h2>

          {longObjective && (
            <button
              type="button"
              className="button-quiet operation-objective-toggle"
              aria-expanded={objectiveOpen}
              aria-controls="operation-objective"
              onClick={() => setObjectiveOpen((open) => !open)}
            >
              {objectiveOpen ? "Show less" : "Show the whole objective"}
            </button>
          )}

          <div className="operation-state">
            <StatusPill tone={headerTone} pulse={state.live}>
              {headerLabel}
            </StatusPill>

            <p className="operation-line">{state.line}</p>
          </div>

          {state.note && <p className="operation-note">{state.note}</p>}

          {briefing && (
            <div className="operation-brief">
              <div className="operation-brief-label">What you told it</div>
              {briefing}
            </div>
          )}

          {toDecide > 0 && !state.live && (
            <a href="#debrief" className="operation-debrief">
              This mission taught the company {toDecide}{" "}
              {toDecide === 1 ? "thing" : "things"}. Decide what to keep.
            </a>
          )}

          <Stations
            state={state}
            planned={plan.totalCount > 0}
            queued={Boolean(executionJob)}
            createdAt={work.createdAt}
            startedAt={work.startedAt}
            completedAt={work.completedAt}
            waiting={pending.length > 0}
            taskCount={plan.totalCount}
          />

          <div className="operation-readout">
            <Fact
              label="Steps done"
              value={
                plan.totalCount === 0
                  ? "—"
                  : `${plan.completedCount}/${plan.totalCount}`
              }
            />
            <Fact label="Running now" value={plan.runningCount || "—"} />
            <Fact label="Agents on it" value={data.cast.length || "—"} />
            <Fact
              label="Ran for"
              value={formatDuration(work.startedAt, work.completedAt)}
            />
          </div>

          {/* How the run was shaped, for whoever wants the machinery. */}
          {plan.totalCount > 0 && (
            <details className="tech-detail operation-technical">
              <summary>Technical details</summary>

              <dl className="operation-technical-list">
                <dt>Steps able to run side by side</dt>
                <dd>{plan.widestLane > 1 ? plan.widestLane : "none; one after another"}</dd>
                <dt>Tool calls made</dt>
                <dd>{toolCalls}</dd>
                {executionJob && (
                  <>
                    <dt>Queue attempts</dt>
                    <dd>{executionJob.attempts}</dd>
                  </>
                )}
              </dl>
            </details>
          )}

          <div className="operation-controls">
            {(opening || (!opening && work.status === "planning")) && (
              <span className="running-indicator">
                <LoaderCircle size={13} className="spin-slow" />
                {planner
                  ? `${planner} is writing the plan`
                  : "The plan is being written"}
              </span>
            )}

            {canOperate && !opening && plan.totalCount === 0 && work.status === "queued" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run("plan", () => planWork(work.id))}
                className="button-primary"
              >
                <Play size={13} />
                {action === "plan" ? "Planning…" : "Build the plan"}
              </button>
            )}

            {!opening && executionJob?.status === "queued" && (
              <span className="running-indicator">
                <LoaderCircle size={13} className="spin-slow" />
                {executionJob.attempts > 0
                  ? `Requeued for attempt ${executionJob.attempts + 1}`
                  : "Waiting for a worker"}
              </span>
            )}

            {!opening && executionJob?.status === "running" && (
              <span className="running-indicator">
                <LoaderCircle size={13} className="spin-slow" />
                Running on {executionJob.claimedBy ?? "a worker"}
              </span>
            )}

            {canOperate &&
              !opening &&
              plan.totalCount > 0 &&
              !executionJob &&
              (work.status === "queued" || work.status === "executing") && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run("execute", () => executeWork(work.id))}
                  className="button-primary"
                >
                  <Play size={13} />
                  {action === "execute"
                    ? "Starting…"
                    : work.status === "executing"
                      ? "Resume it"
                      : "Run it"}
                </button>
              )}

            {canOperate && work.status === "failed" && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run("retry", async () => {
                    const retried = await retryWork(work.id);
                    if (retried.mode === "replan") {
                      await launchWork(work.id);
                    }
                  })
                }
                className="button-primary"
              >
                <RotateCcw size={13} />
                {action === "retry"
                  ? "Resuming…"
                  : work.metadata.interrupted
                    ? "Resume it"
                    : "Retry it"}
              </button>
            )}

            {/* Offered only where the server would allow it: not while a
                worker is running the mission or its plan is being written.
                The server decides either way; this only avoids offering a
                button that would be refused. */}
            {canOperate &&
              !opening &&
              executionJob?.status !== "running" &&
              ["queued", "executing", "waiting_approval", "failed"].includes(work.status) &&
              (confirmingCancel ? (
                <span className="inline-flex items-center gap-2">
                  <span className="t-meta">Cancel this mission? Finished steps are kept.</span>
                  <button
                    type="button"
                    disabled={busy}
                    className="button-ghost"
                    onClick={() =>
                      run("cancel", async () => {
                        await cancelWork(work.id);
                        setConfirmingCancel(false);
                      })
                    }
                  >
                    {action === "cancel" ? "Cancelling…" : "Yes, cancel it"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="button-quiet"
                    onClick={() => setConfirmingCancel(false)}
                  >
                    Keep it
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  className="button-quiet"
                  onClick={() => setConfirmingCancel(true)}
                >
                  <Ban size={12} />
                  Cancel mission
                </button>
              ))}

            <button
              type="button"
              onClick={room.reload}
              className="button-quiet"
              disabled={busy}
            >
              <RefreshCw
                size={12}
                className={room.refreshing ? "spin-slow" : undefined}
              />
              Refresh
            </button>
          </div>

          {actionError && (
            <div className="mt-6 max-w-[70ch]">
              <Failure
                headline="That did not go through"
                detail={actionError}
                consequence="Nothing was changed. The mission is where it was."
              />
            </div>
          )}
        </div>
      </header>

      <DecisionBand
        approvals={pending}
        requestedBy={agentName}
        holding={stepNamed}
        busy={busy}
        onDecide={(approvalId, decision) =>
          run(decision, () =>
            resolveApproval(approvalId, decision),
          )
        }
      />

      <div className="room-layout">
        <div className="room-main">
          <MissionGovernance summary={governance} />

          {failure && (
            <div className="mb-8">
              {work.metadata.interrupted ? (
                <div className="callout callout-warning">
                  <div className="detail-label mb-1.5">Interrupted</div>
                  {failure}
                  <div className="mt-2 text-(length:--text-xs) text-warning-muted">
                    The process stopped, not the mission. Finished steps were
                    kept and it resumes from the first one that did not finish.
                  </div>
                </div>
              ) : (
                <Failure
                  headline={
                    plan.totalCount === 0
                      ? "The plan was never written"
                      : "The mission stopped"
                  }
                  detail={failure}
                  consequence={
                    plan.totalCount === 0
                      ? "Nothing was delegated and nothing ran. A retry starts the planning again."
                      : "Nothing finished was lost. A retry resumes from the first step that did not complete."
                  }
                />
              )}
            </div>
          )}

          {executionJob?.lastError && executionJob.status === "queued" && (
            <div className="callout callout-warning mb-8">
              <div className="detail-label mb-1.5">
                Attempt {executionJob.attempts} did not finish
              </div>
              {executionJob.lastError} UNIOFFICE put it back on the queue, and
              a worker will resume it without you.
            </div>
          )}

          {/* What the answer is worth, then the answer. A mission that
              executed perfectly can still have produced something nobody
              should act on, and leading with the prose hid that. */}
          {(result || narrative.outcome.status !== "running") && (
            <MissionResultBrief
              outcome={narrative.outcome}
              result={
                result
                  ? {
                      value: result.result,
                      title: result.title,
                      at: result.completedAt ?? result.updatedAt,
                    }
                  : undefined
              }
              producedBy={result ? agentName(result.assignedAgentId) : undefined}
              artifacts={artifacts}
              onOpenArtifact={setOpenArtifact}
            />
          )}

          {plan.totalCount === 0 && !work.metadata.planningError && !opening ? (
            <Quiet
              line="Nothing has been decided yet."
              detail="This objective is recorded and nothing else. Build the plan and the strategy, the workforce and every step of the execution appear here as they happen."
            />
          ) : (
            plan.totalCount > 0 && (
              <>
                <Chapter
                  index={chapter("floor")}
                  title="The work"
                  action={
                    <span className="t-machine">
                      {plan.progress}% through
                    </span>
                  }
                />

                <ExecutionFloor
                  room={data}
                  focused={focused}
                  onFocus={setFocused}
                />
              </>
            )
          )}

          {data.cast.length > 0 && (
            <>
              <Chapter
                index={chapter("cast")}
                title="Who is on it"
                action={
                  <span className="t-machine">
                    chosen for what each can do
                  </span>
                }
              />

              <RoomCast room={data} />
            </>
          )}

          {narrative.handoffs.length > 0 && (
            <>
              <Chapter
                index={chapter("handoffs")}
                title="Where work changed hands"
                action={
                  <span className="t-machine">
                    one specialist's finished work becoming another's input
                  </span>
                }
              />

              <MissionHandoffs
                handoffs={narrative.handoffs}
                artifacts={artifacts}
                onOpenArtifact={setOpenArtifact}
              />
            </>
          )}

          <Chapter
            index={chapter("timeline")}
            title="What happened"
            action={
              <span className="t-machine">
                {narrative.timeline.length}{" "}
                {narrative.timeline.length === 1 ? "moment" : "moments"}
              </span>
            }
          />

          <MissionTimeline entries={narrative.timeline} />

          {settled.length > 0 && (
            <>
              <Chapter index={chapter("decisions")} title="What needed a person" />

              <div className="space-y-2">
                {settled.map((approval) => (
                  <div key={approval.id} className="settled-decision">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-(length:--text-md) font-semibold text-ink-primary">
                          {approval.action}
                        </div>
                        {(() => {
                          const step = stepNamed(approval.resource, approval.taskId);

                          return step && step !== approval.action ? (
                            <div className="t-machine mt-1">held up {step}</div>
                          ) : null;
                        })()}
                      </div>

                      <StatusPill
                        tone={approval.status === "approved" ? "live" : "error"}
                      >
                        {approval.status}
                      </StatusPill>
                    </div>

                    <p className="mt-3 text-(length:--text-sm) leading-[1.7] text-ink-secondary">
                      {approval.reason}
                    </p>

                    <div className="t-machine mt-2.5">
                      asked by {agentName(approval.agentId)} ·{" "}
                      {formatRelativeTime(approval.createdAt)}
                      {approval.resolvedAt &&
                        ` · answered ${formatRelativeTime(approval.resolvedAt)}`}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {(artifacts.length > 0 || review.length > 0 || used.length > 0) && (
            <>
              <Chapter index={chapter("left")} title="What it left behind" />

              {artifacts.length > 0 && (
                <>
                  <p className="room-lead">
                    {artifacts.length} durable{" "}
                    {artifacts.length === 1 ? "artifact" : "artifacts"}, stored
                    the moment the step producing it completed — so the output
                    outlives the run that made it.
                  </p>

                  <div className="workbench">
                    {artifacts.map((artifact) => (
                      <button
                        key={artifact.id}
                        type="button"
                        className="artifact-tile"
                        onClick={() => setOpenArtifact(artifact)}
                      >
                        <span className="artifact-tile-name">
                          {artifact.name}
                        </span>

                        {artifact.metadata.content !== undefined && (
                          <span className="artifact-tile-excerpt">
                            {excerptOf(artifact.metadata.content, 190)}
                          </span>
                        )}

                        <span className="artifact-tile-foot">
                          <Chip tone="live">{artifact.type}</Chip>
                          <span className="t-machine">
                            {agentName(artifact.createdByAgentId)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {used.length > 0 && (
                <div className={artifacts.length > 0 ? "mt-10" : ""}>
                  <p className="room-headline">
                    Used {used.length} {used.length === 1 ? "piece" : "pieces"} of company knowledge
                  </p>
                  <p className="room-lead">
                    Recalled before planning and before each step, from what earlier work taught the
                    company. Each entry says why it was chosen.
                  </p>

                  <div className="knowledge-list">
                    {used.map((entry) => (
                      <div key={entry.knowledge.id} className="learned-line">
                        <div className="learned-when">
                          {entry.stages.includes("planning") ? "planning" : "a step"}
                        </div>
                        <div className="min-w-0">
                          <Link to={`/brain/${entry.knowledge.id}`} className="learned-title">
                            {entry.knowledge.title}
                          </Link>
                          <div className="learned-source">
                            {kindLabel(entry.knowledge.type)} · {knowledgeStatusLabel(entry.knowledge.status)}
                            {entry.knowledge.workId && entry.knowledge.workId !== work.id && (
                              <>
                                {" · "}
                                <Link to={`/missions/${entry.knowledge.workId}`} className="hover:text-blue-ink">
                                  learned in an earlier mission
                                </Link>
                              </>
                            )}
                          </div>
                          {entry.reasons.length > 0 && (
                            <ul className="knowledge-why">
                              {entry.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {review.length > 0 && (
                <div
                  id="debrief"
                  className={artifacts.length > 0 || used.length > 0 ? "mt-10" : ""}
                >
                  <MissionDebrief
                    review={review}
                    live={state.live}
                    onChanged={knowledge.reload}
                  />

                  <Link to="/brain" className="button-quiet mt-4 inline-flex">
                    Everything the company knows
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="room-record">
          <MissionRecord moments={moments} live={state.live} />
        </aside>
      </div>

      {openArtifact && (
        <ArtifactSheet
          artifact={openArtifact}
          producedBy={agentName(openArtifact.createdByAgentId)}
          onClose={() => setOpenArtifact(undefined)}
        />
      )}
    </div>
  );
}

/**
 * Whether the page is actually being fed.
 *
 * Reports the channel's real state rather than a decorative dot: connected
 * and the room updates itself, disconnected and it is falling back to asking
 * on a timer. Both are fine and a person is entitled to know which.
 */
function Pulse({
  status,
  live,
}: {
  status: "connecting" | "live" | "offline";
  live: boolean;
}) {
  if (!live) return <span className="operation-mark">Mission</span>;

  return (
    <span className={`pulse pulse-${status}`}>
      <span className="pulse-dot" aria-hidden="true" />
      {status === "live"
        ? "Live"
        : status === "connecting"
          ? "Connecting"
          : "Polling"}
    </span>
  );
}

/** Which wash the header carries, from the mission's own state. */
function moodOf(state: MissionState): string {
  if (state.phase === "waiting") return "operation-waiting";
  if (state.phase === "delivered") return "operation-done";
  if (state.phase === "stopped") return "operation-stopped";
  return state.live ? "operation-live" : "";
}

/**
 * The stations a mission passes through.
 *
 * Every one is a state the work rows and the durable queue genuinely report.
 * Nothing here is a step invented to make a progress bar look fuller.
 */
function Stations({
  state,
  planned,
  queued,
  createdAt,
  startedAt,
  completedAt,
  waiting,
  taskCount,
}: {
  state: MissionState;
  planned: boolean;
  queued: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  waiting: boolean;
  taskCount: number;
}) {
  const ran = Boolean(startedAt);
  const finished = state.phase === "delivered" || state.phase === "stopped";

  const stations = [
    {
      label: "Received",
      detail: formatRelativeTime(createdAt),
      passed: true,
      now: state.phase === "unplanned",
    },
    {
      label: "Planned",
      detail: planned
        ? `${taskCount} ${taskCount === 1 ? "step" : "steps"}`
        : undefined,
      passed: planned,
      now: state.phase === "planning",
    },
    {
      label: "Queued",
      detail: queued ? "on the queue" : undefined,
      passed: planned && (queued || ran),
      now: state.phase === "queued" || state.phase === "recovering",
    },
    {
      label: waiting ? "Waiting for you" : "Running",
      detail: startedAt ? formatRelativeTime(startedAt) : undefined,
      passed: ran,
      now:
        state.phase === "running" ||
        state.phase === "claimed" ||
        state.phase === "waiting",
    },
    {
      label: state.phase === "stopped" ? "Stopped" : "Delivered",
      detail: completedAt ? formatRelativeTime(completedAt) : undefined,
      passed: finished,
      now: finished,
    },
  ];

  return (
    <div className="stations" role="list" aria-label="Where the mission is">
      {stations.map((station) => (
        <div
          key={station.label}
          role="listitem"
          aria-current={station.now ? "step" : undefined}
          className={`station${
            station.now
              ? " station-now"
              : station.passed
                ? " station-passed"
                : ""
          }`}
        >
          <span className="station-node" aria-hidden="true" />
          <span className="station-label">{station.label}</span>
          {station.detail && (
            <span className="station-detail">{station.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fact">
      <div className="fact-value">{value}</div>
      <div className="fact-label">{label}</div>
    </div>
  );
}
