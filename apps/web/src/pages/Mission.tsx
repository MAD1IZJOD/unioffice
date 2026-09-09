import {
  ArrowLeft,
  ChevronRight,
  LoaderCircle,
  Play,
  RefreshCw,
  RotateCcw,
  Wrench,
} from "lucide-react";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import {
  executeWork,
  fetchAgents,
  fetchTools,
  fetchWorkDetail,
  formatDuration,
  formatRelativeTime,
  planWork,
  resolveApproval,
  retryWork,
  type AgentSummary,
  type ApprovalItem,
  type ArtifactItem,
  type TaskItem,
  type ToolDescriptor,
  type WorkDetail as WorkDetailData,
  type WorkStatus,
} from "../lib/api";

import { useResource } from "../lib/useResource";
import { excerptOf, safeStringify } from "../lib/events";

import {
  briefingOf,
  messageOf,
  missionCast,
  missionDataOf,
  missionProgress,
  missionResult,
  missionToolCalls,
  narrateMission,
  orchestratorOf,
  readMission,
  type MissionState,
} from "../lib/mission";

import {
  Chip,
  Connecting,
  Failure,
  Quiet,
  StatusPill,
} from "../components/primitives";

import { ResultBody } from "../components/ResultBody";
import { ArtifactSheet } from "../components/ArtifactSheet";
import { MissionRecord } from "../components/MissionRecord";
import { MissionCast } from "../components/MissionCast";

import { statusLabel, taskStatusTone, toneClass } from "../lib/tone";

// No auth yet, so a decision is attributed to the seeded development
// requester rather than inventing an identity the backend cannot verify.
const RESOLVER_ID = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

/** A mission that can still change is watched closely; a settled one is not. */
const LIVE_POLL_MS = 4_000;
const SETTLED_POLL_MS = 30_000;

const SETTLED_STATUSES: ReadonlyArray<WorkStatus> = [
  "completed",
  "failed",
  "cancelled",
];

/**
 * Watches one mission, polling closely while it can still change and backing
 * off once it settles. The interval is adjusted during render - React's
 * documented alternative to an effect for state derived from data the
 * component already has - rather than mirrored by an effect.
 */
function useWatchedMission(workId: string) {
  const [pollMs, setPollMs] = useState(LIVE_POLL_MS);
  const detail = useResource<WorkDetailData>(
    useCallback(() => fetchWorkDetail(workId), [workId]),
    { pollMs, enabled: Boolean(workId) },
  );

  const status = detail.data?.work.status;
  const nextPollMs =
    status && SETTLED_STATUSES.includes(status) ? SETTLED_POLL_MS : LIVE_POLL_MS;

  if (nextPollMs !== pollMs) {
    setPollMs(nextPollMs);
  }

  return detail;
}

export default function Mission() {
  const { missionId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const [action, setAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [openArtifact, setOpenArtifact] = useState<ArtifactItem>();

  const detail = useWatchedMission(missionId);

  // Tool names, so the record can say "Harvey reached for Calculator" instead
  // of printing a registry id. Read once - the catalog does not move.
  const tools = useResource<ToolDescriptor[]>(useCallback(() => fetchTools(), []));

  // The mission's own agent list holds only the specialists it was delegated
  // to, so the orchestrator that planned it is not in there. The record needs
  // to name it, which is what the roster is for.
  const roster = useResource<AgentSummary[]>(useCallback(() => fetchAgents(), []));

  const run = useCallback(
    async (label: string, operation: () => Promise<unknown>) => {
      setAction(label);
      setActionError(undefined);

      try {
        await operation();
        detail.reload();
      } catch (error) {
        setActionError((error as Error).message);
      } finally {
        setAction(undefined);
      }
    },
    [detail],
  );

  // A mission opened from the creation surface starts itself: it is planned,
  // then queued, on this page, so the person watches the operation begin where
  // it will keep happening. The ref makes it once-only under StrictMode, and
  // the history entry is rewritten so a refresh does not replay it.
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

  if (detail.loading) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <Connecting what="Opening the mission…" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-[1080px] pt-4">
        <Failure
          headline="This mission could not be opened"
          detail={detail.error?.message ?? "The API returned nothing for this id."}
          consequence={
            detail.error?.isOffline
              ? "The mission itself is unaffected — a worker runs it from the queue, not from this page."
              : undefined
          }
          action={
            <>
              <button type="button" onClick={detail.reload} className="button-ghost">
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

  const { work, tasks, events, artifacts, approvals, agents, memories, executionJob } =
    detail.data;

  // Everyone the record might have to name: the specialists this mission used,
  // plus the rest of the roster once it has loaded.
  const everyone = [
    ...agents,
    ...(roster.data ?? []).filter(
      (candidate) => !agents.some((agent) => agent.id === candidate.id),
    ),
  ];

  const data = missionDataOf(detail.data);
  const state = readMission(data);
  const cast = missionCast(data);
  const planner = orchestratorOf(everyone);
  const briefing = briefingOf(work);

  const moments = narrateMission(events, {
    tasks,
    agents: everyone,
    tools: tools.data,
  });

  const pending = approvals.filter((approval) => approval.status === "pending");
  const settledApprovals = approvals.filter(
    (approval) => approval.status !== "pending",
  );
  const toolCalls = missionToolCalls(tasks);
  const progress = missionProgress(tasks);
  const completed = tasks.filter((task) => task.status === "completed").length;
  const result = missionResult(tasks);
  const failure = messageOf(work);

  const agentName = (id?: string) =>
    everyone.find((agent) => agent.id === id)?.name ?? "Unassigned";

  // An approval's resource is stored as "task:<uuid>", which is the right way
  // to store it and the wrong way to read it. The task it points at is on this
  // page, so it is named; anything else is shown as it was recorded.
  const resourceName = (resource: string) => {
    const taskId = resource.startsWith("task:") ? resource.slice(5) : undefined;
    return tasks.find((task) => task.id === taskId)?.title ?? resource;
  };

  const busy = Boolean(action);
  const opening = action === "open";

  return (
    <div className="fade-up">
      <header className={`mission-open ${toneClass[state.tone]} ${openMood(state)}`}>
        <div className="mission-open-inner">
          <Link to="/missions" className="button-quiet mb-6 inline-flex">
            <ArrowLeft size={12} />
            Every mission
          </Link>

          <div className="mission-eyebrow">
            <span className="mission-eyebrow-mark">Mission</span>
            <span>opened {formatRelativeTime(work.createdAt)}</span>
            <span>{work.priority} priority</span>
          </div>

          <div className="flex flex-wrap items-start justify-between gap-5">
            <h2
              className={`mission-objective${
                work.objective.length > 90 ? " mission-objective-long" : ""
              }`}
            >
              {work.objective}
            </h2>

            <StatusPill tone={state.tone} pulse={state.live}>
              {state.label}
            </StatusPill>
          </div>

          <p className="mission-state">{state.line}</p>
          {state.note && <p className="mission-state-note">{state.note}</p>}

          {briefing && (
            <div className="mission-brief">
              <div className="mission-brief-label">What you told it</div>
              {briefing}
            </div>
          )}

          <Stations
            state={state}
            tasks={tasks}
            queued={Boolean(executionJob)}
            startedAt={work.startedAt}
            createdAt={work.createdAt}
            completedAt={work.completedAt}
            waiting={pending.length > 0}
          />

          <div className="dispatch-meta !mt-7">
            <Fact
              label="Plan"
              value={tasks.length === 0 ? "—" : `${completed}/${tasks.length}`}
            />
            <Fact label="Workforce" value={cast.length || "—"} />
            <Fact label="Tool calls" value={toolCalls.length} />
            <Fact label="Artifacts" value={artifacts.length} />
            <Fact
              label="Ran for"
              value={formatDuration(work.startedAt, work.completedAt)}
            />
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            {opening && (
              <span className="running-indicator">
                <LoaderCircle size={13} className="spin-slow" />
                {planner
                  ? `${planner} is writing the plan`
                  : "The plan is being written"}
              </span>
            )}

            {!opening &&
              tasks.length === 0 &&
              (work.status === "queued" || work.status === "planning") && (
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
              tasks.length > 0 &&
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
                      ? "Resume the mission"
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
                    ? "Resume this mission"
                    : "Retry this mission"}
              </button>
            )}

            <button
              type="button"
              onClick={detail.reload}
              className="button-quiet"
              disabled={busy}
            >
              <RefreshCw
                size={12}
                className={detail.refreshing ? "spin-slow" : undefined}
              />
              Refresh
            </button>
          </div>

          {actionError && (
            <div className="mt-5 max-w-[70ch]">
              <Failure
                headline="That did not go through"
                detail={actionError}
                consequence="Nothing was changed. The mission is where it was."
              />
            </div>
          )}
        </div>
      </header>

      <div className="mission-layout">
        <div className="mission-main">
          {pending.length > 0 && (
            <div className="mission-decision">
              <div className="mission-decision-label">Waiting for you</div>

              {pending.map((approval) => (
                <Decision
                  key={approval.id}
                  approval={approval}
                  requestedBy={agentName(approval.agentId)}
                  holding={resourceName(approval.resource)}
                  busy={busy}
                  onDecide={(decision) =>
                    run(decision, () =>
                      resolveApproval(approval.id, decision, RESOLVER_ID),
                    )
                  }
                />
              ))}
            </div>
          )}

          {failure && (
            <div className="mt-6">
              {work.metadata.interrupted ? (
                <div className="callout callout-warning">
                  <div className="detail-label mb-1.5">Interrupted</div>
                  {failure}
                  <div className="mt-2 text-[10.5px] text-[#c9a06a]">
                    The process stopped, not the mission. Finished tasks were
                    kept and it resumes from the first one that did not finish.
                  </div>
                </div>
              ) : (
                <Failure
                  headline={
                    tasks.length === 0
                      ? "The plan was never written"
                      : "The mission stopped"
                  }
                  detail={failure}
                  consequence={
                    tasks.length === 0
                      ? "Nothing was delegated and nothing ran. A retry starts the planning again."
                      : "Nothing finished was lost. A retry resumes from the first task that did not complete."
                  }
                />
              )}
            </div>
          )}

          {executionJob?.lastError && executionJob.status === "queued" && (
            <div className="callout callout-warning mt-6">
              <div className="detail-label mb-1.5">
                Attempt {executionJob.attempts} did not finish
              </div>
              {executionJob.lastError} UNI-OFFICE put it back on the queue, and
              a worker will resume it.
            </div>
          )}

          {/* The answer, before any of the machinery that produced it. */}
          {result && (
            <div className="mt-7">
              <div className="delivery">
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
              </div>
            </div>
          )}

          {tasks.length === 0 && !work.metadata.planningError && !opening && (
            <Quiet
              line="Nothing has been decided yet."
              detail="This objective is recorded and nothing else. Build the plan and the strategy, the workforce and every step of the execution appear here as they happen."
            />
          )}

          <Act
            index="01"
            title="Strategy"
            question={
              planner ? `What ${planner} decided to do` : "What was decided"
            }
            tone={tasks.length > 0 ? "active" : "idle"}
            when={tasks.length > 0 || Boolean(work.metadata.planningError)}
          >
            {tasks.length > 0 ? (
              <>
                <p className="mission-act-headline">
                  Broken into {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
                </p>
                <p className="mission-act-lead">
                  Each task names the capabilities and the tools it needs. Those
                  requirements are what the delegator routes on, and a task
                  needing a tool can only go to an agent authorized for it.
                </p>

                <div className="mission-board">
                  {tasks.map((task, index) => (
                    <Step
                      key={task.id}
                      task={task}
                      index={index}
                      agentName={agentName(task.assignedAgentId)}
                      dependencyTitles={task.dependsOn
                        .map((id) => tasks.find((entry) => entry.id === id)?.title)
                        .filter((title): title is string => Boolean(title))}
                      toolLabel={(id) =>
                        tools.data?.find((tool) => tool.id === id)?.name ?? id
                      }
                    />
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mission-act-headline">Nothing was decided</p>
                <p className="mission-act-lead">
                  Planning did not return a usable plan, so the objective was
                  never broken into tasks and no one was given anything. The
                  reason is above.
                </p>
              </>
            )}
          </Act>

          <Act
            index="02"
            title="Workforce"
            question="Who is working on it"
            tone="active"
            when={cast.length > 0}
          >
            <p className="mission-act-headline">
              {cast.length} {cast.length === 1 ? "specialist" : "specialists"} on
              this mission
            </p>
            <p className="mission-act-lead">
              Routed on the capabilities and tool grants each one actually
              holds, not on availability.
            </p>

            <MissionCast members={cast} />
          </Act>

          <Act
            index="03"
            title="Execution"
            question="What is happening now"
            tone={state.live ? "active" : "live"}
            when={tasks.length > 0}
          >
            <p className="mission-act-headline">
              {completed} of {tasks.length} complete
            </p>

            <div className="progress-track mt-4 mb-5">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>

            {toolCalls.length === 0 ? (
              <p className="mission-act-lead">
                No tool has been called on this mission. Everything so far came
                from the agents themselves.
              </p>
            ) : (
              <>
                <p className="mission-act-lead">
                  {toolCalls.length} real tool{" "}
                  {toolCalls.length === 1 ? "call" : "calls"}. Each was validated
                  against the tool's schema and re-checked against the calling
                  agent's authorization before it ran.
                </p>

                <div className="space-y-2">
                  {toolCalls.map(({ call, task }, index) => (
                    <div key={`${call.toolId}-${index}`} className="tool-call">
                      <div className="flex flex-wrap items-center gap-2">
                        <Wrench size={12} className="text-[#84b4fb]" />

                        <span className="mono text-[10.5px] font-semibold text-[#f2f4f7]">
                          {tools.data?.find((tool) => tool.id === call.toolId)
                            ?.name ?? call.toolId}
                        </span>

                        <StatusPill
                          tone={call.status === "completed" ? "live" : "error"}
                        >
                          {call.status}
                        </StatusPill>

                        <span className="t-machine ml-auto truncate">
                          {agentName(task.assignedAgentId)} · {task.title}
                        </span>
                      </div>

                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                        <div className="min-w-0">
                          <div className="detail-label">Given</div>
                          <pre className="code-block mt-1">
                            {safeStringify(call.input, 2)}
                          </pre>
                        </div>

                        <div className="min-w-0">
                          <div className="detail-label">
                            {call.error ? "Error" : "Returned"}
                          </div>
                          <pre className="code-block mt-1">
                            {safeStringify(call.error ?? call.output, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Act>

          <Act
            index="04"
            title="Decisions"
            question="What needed a person"
            tone="warning"
            when={settledApprovals.length > 0}
          >
            <p className="mission-act-headline">
              {settledApprovals.length} human{" "}
              {settledApprovals.length === 1 ? "decision" : "decisions"}
            </p>

            <div className="space-y-2">
              {settledApprovals.map((approval) => (
                <div key={approval.id} className="mission-decision-settled">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold text-[#f2f4f7]">
                        {approval.action}
                      </div>
                      <div className="t-machine mt-1">
                        held up {resourceName(approval.resource)}
                      </div>
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
          </Act>

          <Act
            index="05"
            title="Output"
            question="What the company produced"
            tone="live"
            when={artifacts.length > 0 || memories.length > 0}
          >
            {artifacts.length > 0 && (
              <>
                <p className="mission-act-headline">
                  {artifacts.length} durable{" "}
                  {artifacts.length === 1 ? "artifact" : "artifacts"}
                </p>
                <p className="mission-act-lead">
                  Stored the moment the task producing it completed, so the
                  output outlives the run that made it.
                </p>

                <div className="workbench">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      className="artifact-tile"
                      onClick={() => setOpenArtifact(artifact)}
                    >
                      <span className="artifact-tile-name">{artifact.name}</span>

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
              <div className={artifacts.length > 0 ? "mt-8" : ""}>
                <p className="mission-act-headline">
                  The company remembered {memories.length}{" "}
                  {memories.length === 1 ? "thing" : "things"}
                </p>
                <p className="mission-act-lead">
                  What this mission leaves behind. Agents retrieve from here
                  before starting related work, so the next mission starts from
                  what this one learned.
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
          </Act>
        </div>

        <aside className="mission-record">
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

/** Which wash the header carries. Derived from the mission's own state. */
function openMood(state: MissionState): string {
  if (state.phase === "waiting") return "mission-open-waiting";
  if (state.phase === "delivered") return "mission-open-done";
  if (state.phase === "stopped") return "mission-open-stopped";
  return state.live ? "mission-open-live" : "";
}

/**
 * The stations a mission passes through.
 *
 * Every one of these is a state the work rows and the durable queue genuinely
 * report - nothing here is a step invented to make a progress bar look full.
 */
function Stations({
  state,
  tasks,
  queued,
  createdAt,
  startedAt,
  completedAt,
  waiting,
}: {
  state: MissionState;
  tasks: TaskItem[];
  queued: boolean;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  waiting: boolean;
}) {
  const planned = tasks.length > 0;
  const ran = Boolean(startedAt);
  const finished = state.phase === "delivered" || state.phase === "stopped";

  const stations: Array<{
    label: string;
    detail?: string;
    passed: boolean;
    now: boolean;
  }> = [
    {
      label: "Received",
      detail: formatRelativeTime(createdAt),
      passed: true,
      now: state.phase === "unplanned",
    },
    {
      label: "Planned",
      detail: planned
        ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`
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
    <div className="mission-phases">
      {stations.map((station) => (
        <div
          key={station.label}
          className={`mission-phase${
            station.now
              ? " mission-phase-now"
              : station.passed
                ? " mission-phase-passed"
                : ""
          }`}
        >
          <span>{station.label}</span>
          {station.detail && (
            <span className="mission-phase-detail">{station.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Act({
  index,
  title,
  question,
  tone,
  when,
  children,
}: {
  index: string;
  title: string;
  question: string;
  tone: "active" | "live" | "warning" | "idle";
  /** An act that did not happen is not rendered as an empty one. */
  when: boolean;
  children: ReactNode;
}) {
  if (!when) return null;

  return (
    <section className={`mission-act ${toneClass[tone]}`}>
      <div className="mission-act-head">
        <span className="mission-act-index">{index}</span>
        <span className="mission-act-title">{title}</span>
        <span className="mission-act-question">{question}</span>
      </div>

      {children}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="dispatch-stat tone-idle">
      <div className="dispatch-stat-value !text-[19px]">{value}</div>
      <div className="dispatch-stat-label">{label}</div>
    </div>
  );
}

/**
 * One thing the mission will not do without a person.
 *
 * Three things in order: what is being asked, why it stopped here, and what
 * happens either way - because "approve?" with no consequence attached is not
 * a decision, it is a dialog box.
 */
function Decision({
  approval,
  requestedBy,
  holding,
  busy,
  onDecide,
}: {
  approval: ApprovalItem;
  requestedBy: string;
  /** The step this decision is holding up, named rather than referenced. */
  holding: string;
  busy: boolean;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  return (
    <div>
      <p className="mission-decision-action">{approval.action}</p>
      <p className="mission-decision-why">{approval.reason}</p>

      <p className="mission-decision-next">
        Approving puts the mission straight back on the durable queue and a
        worker resumes it. Rejecting stops this step, and the mission does not
        take it.
      </p>

      <div className="t-machine mt-2.5">
        holding up {holding} · asked by {requestedBy} ·{" "}
        {formatRelativeTime(approval.createdAt)}
      </div>

      <div className="mission-decision-buttons">
        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("approve")}
          className="button-primary button-approve-strong"
        >
          Approve and continue
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => onDecide("reject")}
          className="button-ghost button-reject"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function Step({
  task,
  index,
  agentName,
  dependencyTitles,
  toolLabel,
}: {
  task: TaskItem;
  index: number;
  agentName: string;
  dependencyTitles: string[];
  toolLabel: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const toolCalls = task.metadata.execution?.toolCalls ?? [];
  const requiredTools = task.metadata.routing?.requiredTools ?? [];
  const hasResult = task.result !== undefined && task.result !== "";
  const tone = taskStatusTone(task.status);

  return (
    <div className={`mission-step ${toneClass[tone]}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mission-step-head"
        aria-expanded={open}
      >
        <span className="mission-step-rail" />

        <span className="mission-step-index">
          {String(index + 1).padStart(2, "0")}
        </span>

        <span className="min-w-0">
          <span className="mission-step-title block">{task.title}</span>

          <span className="mission-step-meta">
            <span>{agentName}</span>

            {requiredTools.map((tool) => (
              <span key={tool} className="tool-tag">
                {toolLabel(tool)}
              </span>
            ))}

            {toolCalls.length > 0 && (
              <span>
                {toolCalls.length} tool{" "}
                {toolCalls.length === 1 ? "call" : "calls"}
              </span>
            )}

            {task.startedAt && task.completedAt && (
              <span>{formatDuration(task.startedAt, task.completedAt)}</span>
            )}

            {dependencyTitles.length > 0 && (
              <span>after {dependencyTitles.join(", ")}</span>
            )}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 pt-0.5">
          <StatusPill tone={tone} pulse={task.status === "running"}>
            {statusLabel(task.status)}
          </StatusPill>

          <ChevronRight
            size={14}
            className={`text-[#535b68] transition-transform ${open ? "rotate-90" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="mission-step-body">
          <p className="text-[11.5px] leading-[1.7] text-[#a7b0bd]">
            {task.description}
          </p>

          {task.metadata.execution?.error && (
            <div className="callout callout-error mt-4">
              {task.metadata.execution.error.message}
            </div>
          )}

          {hasResult && (
            <div className="mt-4">
              <div className="detail-label">What it returned</div>
              <div className="result-block mt-2">
                <ResultBody value={task.result} />
              </div>
            </div>
          )}

          {!hasResult && !task.metadata.execution?.error && (
            <p className="mt-4 text-[10.5px] text-[#535b68]">
              {task.status === "waiting"
                ? "Holding for an approval decision."
                : "Nothing has come back from this step yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
