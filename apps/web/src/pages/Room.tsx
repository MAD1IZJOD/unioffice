import {
  ArrowLeft,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  executeWork,
  fetchExecutionRoom,
  formatDuration,
  formatRelativeTime,
  planWork,
  resolveApproval,
  retryWork,
  type ArtifactItem,
  type ExecutionRoom as ExecutionRoomData,
} from "../lib/api";

import { useLiveResource } from "../lib/live";
import { excerptOf } from "../lib/events";

import {
  briefingOf,
  messageOf,
  narrateMission,
  readMission,
  type MissionState,
} from "../lib/mission";

import { missionDataOfRoom, roomResult } from "../lib/room";

import { toneClass } from "../lib/tone";

import { Chapter, Chip, Connecting, Failure, Quiet, StatusPill } from "../components/primitives";

import { ArtifactSheet } from "../components/ArtifactSheet";
import { MissionRecord } from "../components/MissionRecord";
import { ResultBody } from "../components/ResultBody";
import { WorkspaceMark } from "../components/WorkspaceMark";

import { DecisionBand } from "../components/room/DecisionBand";
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

// No auth yet, so a decision is attributed to the seeded development
// requester rather than inventing an identity the backend cannot verify.
const RESOLVER_ID = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

/** Used only when the live channel is unavailable. */
const FALLBACK_POLL_MS = 4_000;

export default function Room() {
  const { missionId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [action, setAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [openArtifact, setOpenArtifact] = useState<ArtifactItem>();
  const [focused, setFocused] = useState<string>();

  const room = useLiveResource<ExecutionRoomData>(
    useCallback(() => fetchExecutionRoom(missionId), [missionId]),
    {
      workId: missionId,
      fallbackPollMs: FALLBACK_POLL_MS,
      enabled: Boolean(missionId),
    },
  );

  const { reload } = room;

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

    void run("open", async () => {
      await planWork(missionId);
      await executeWork(missionId);
    });
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
  const { work, plan, approvals, artifacts, memories, executionJob, workspace } =
    data;

  const state = readMission(missionDataOfRoom(data));
  const moments = narrateMission(data.events, {
    tasks: data.tasks,
    agents: data.agents,
    tools: data.tools,
  });

  const pending = approvals.filter((approval) => approval.status === "pending");
  const settled = approvals.filter((approval) => approval.status !== "pending");
  const result = roomResult(data);
  const failure = messageOf(work);
  const briefing = briefingOf(work);
  const planner = data.orchestrator?.name;

  const agentName = (id?: string) =>
    data.agents.find((agent) => agent.id === id)?.name ?? "Unassigned";

  // An approval's resource is stored as "task:<uuid>", which is the right way
  // to store it and the wrong way to read it.
  const stepNamed = (resource: string) => {
    const taskId = resource.startsWith("task:") ? resource.slice(5) : undefined;
    return plan.nodes.find((node) => node.taskId === taskId)?.title ?? resource;
  };

  const busy = Boolean(action);
  const opening = action === "open";
  const toolCalls = plan.nodes.reduce(
    (total, node) => total + node.toolCallCount,
    0,
  );

  return (
    <div className="room fade-up">
      <header className={`operation ${toneClass[state.tone]} ${moodOf(state)}`}>
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
          </div>

          <h2
            className={`operation-objective${
              work.objective.length > 110 ? " operation-objective-long" : ""
            }`}
          >
            {work.objective}
          </h2>

          <div className="operation-state">
            <StatusPill tone={state.tone} pulse={state.live}>
              {state.label}
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
              label="Plan"
              value={
                plan.totalCount === 0
                  ? "—"
                  : `${plan.completedCount}/${plan.totalCount}`
              }
            />
            <Fact label="Running now" value={plan.runningCount || "—"} />
            <Fact
              label="At once"
              value={plan.widestLane > 1 ? `${plan.widestLane} wide` : "in order"}
            />
            <Fact label="Workforce" value={data.cast.length || "—"} />
            <Fact label="Tool calls" value={toolCalls} />
            <Fact
              label="Ran for"
              value={formatDuration(work.startedAt, work.completedAt)}
            />
          </div>

          <div className="operation-controls">
            {(opening || (!opening && work.status === "planning")) && (
              <span className="running-indicator">
                <LoaderCircle size={13} className="spin-slow" />
                {planner
                  ? `${planner} is writing the plan`
                  : "The plan is being written"}
              </span>
            )}

            {!opening && plan.totalCount === 0 && work.status === "queued" && (
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

            {!opening &&
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

            {work.status === "failed" && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run("retry", async () => {
                    const retried = await retryWork(work.id);
                    if (retried.mode === "replan") {
                      await planWork(work.id);
                      await executeWork(work.id);
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
            resolveApproval(approvalId, decision, RESOLVER_ID),
          )
        }
      />

      <div className="room-layout">
        <div className="room-main">
          {failure && (
            <div className="mb-8">
              {work.metadata.interrupted ? (
                <div className="callout callout-warning">
                  <div className="detail-label mb-1.5">Interrupted</div>
                  {failure}
                  <div className="mt-2 text-[10.5px] text-[#c9a06a]">
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
              {executionJob.lastError} UNI-OFFICE put it back on the queue, and
              a worker will resume it without you.
            </div>
          )}

          {/* The answer, before any of the machinery that produced it. */}
          {result && (
            <section className="delivery">
              <div className="delivery-eyebrow">What the company produced</div>

              <div className="delivery-body">
                <ResultBody value={result.result} />
              </div>

              <div className="delivery-foot">
                <span className="t-machine">
                  {agentName(result.assignedAgentId)}
                </span>
                <span className="t-machine">{result.title}</span>
                <span className="t-machine">
                  {formatRelativeTime(result.completedAt ?? result.updatedAt)}
                </span>
              </div>
            </section>
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
                  index="01"
                  title="The floor"
                  action={
                    <span className="t-machine">
                      {plan.lanes.length}{" "}
                      {plan.lanes.length === 1 ? "lane" : "lanes"} ·{" "}
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
                index="02"
                title="Who is on it"
                action={
                  <span className="t-machine">
                    routed on capability, not availability
                  </span>
                }
              />

              <RoomCast room={data} />
            </>
          )}

          {settled.length > 0 && (
            <>
              <Chapter index="03" title="What needed a person" />

              <div className="space-y-2">
                {settled.map((approval) => (
                  <div key={approval.id} className="settled-decision">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-semibold text-[#f2f4f7]">
                          {approval.action}
                        </div>
                        {stepNamed(approval.resource) !== approval.action && (
                          <div className="t-machine mt-1">
                            held up {stepNamed(approval.resource)}
                          </div>
                        )}
                      </div>

                      <StatusPill
                        tone={approval.status === "approved" ? "live" : "error"}
                      >
                        {approval.status}
                      </StatusPill>
                    </div>

                    <p className="mt-3 text-[11.5px] leading-[1.7] text-[#a7b0bd]">
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

          {(artifacts.length > 0 || memories.length > 0) && (
            <>
              <Chapter index={settled.length > 0 ? "04" : "03"} title="What it left behind" />

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

              {memories.length > 0 && (
                <div className={artifacts.length > 0 ? "mt-10" : ""}>
                  <p className="room-headline">
                    This mission taught the company {memories.length}{" "}
                    {memories.length === 1 ? "thing" : "things"}
                  </p>
                  <p className="room-lead">
                    Agents retrieve from here before starting related work, so
                    the next mission begins from what this one learned.
                  </p>

                  <div className="space-y-2">
                    {memories.map((memory) => (
                      <div key={memory.id} className="callout">
                        <div className="detail-label mb-1.5">
                          {memory.type} · {formatRelativeTime(memory.createdAt)}
                        </div>
                        {memory.content}
                      </div>
                    ))}
                  </div>

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
      detail: queued ? "durable job" : undefined,
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
    <div className="stations">
      {stations.map((station) => (
        <div
          key={station.label}
          className={`station${
            station.now
              ? " station-now"
              : station.passed
                ? " station-passed"
                : ""
          }`}
        >
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
