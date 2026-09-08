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
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  executeWork,
  fetchWorkDetail,
  formatDuration,
  formatRelativeTime,
  planWork,
  resolveApproval,
  retryWork,
  type AgentSummary,
  type ApprovalItem,
  type ArtifactItem,
  type MemoryItem,
  type TaskItem,
  type WorkDetail as WorkDetailData,
  type WorkStatus,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import { describeEvent, excerptOf, safeStringify } from "../lib/events";

import {
  Chip,
  Connecting,
  Failure,
  Quiet,
  StatusPill,
} from "../components/primitives";

import { ResultBody } from "../components/ResultBody";
import { ArtifactSheet } from "../components/ArtifactSheet";
import { AgentMark } from "../components/AgentMark";

import { profileOf } from "../lib/workforce";
import { statusLabel, taskStatusTone, workStatusTone } from "../lib/tone";

// No auth yet, so a decision is attributed to the seeded development
// requester rather than inventing an identity the backend cannot verify.
const RESOLVER_ID = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

/** Work that can still change is watched closely; settled work is not. */
const LIVE_POLL_MS = 4_000;
const SETTLED_POLL_MS = 30_000;

const SETTLED_STATUSES: ReadonlyArray<WorkStatus> = [
  "completed",
  "failed",
  "cancelled",
];

/**
 * Watches one work item, polling closely while it can still change and backing
 * off once it settles. The interval is adjusted during render (React's
 * documented alternative to an effect for state derived from data the
 * component already has) rather than mirrored by an effect.
 */
function useWatchedWorkDetail(workId: string) {
  const [pollMs, setPollMs] = useState(LIVE_POLL_MS);
  const detail = useResource<WorkDetailData>(
    useCallback(() => fetchWorkDetail(workId), [workId]),
    { pollMs, enabled: Boolean(workId) },
  );

  const status = detail.data?.work.status;
  const nextPollMs =
    status && SETTLED_STATUSES.includes(status)
      ? SETTLED_POLL_MS
      : LIVE_POLL_MS;

  if (nextPollMs !== pollMs) {
    setPollMs(nextPollMs);
  }

  return detail;
}

export default function WorkDetail() {
  const { workId = "" } = useParams();
  const [action, setAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [openArtifact, setOpenArtifact] = useState<ArtifactItem>();

  const detail = useWatchedWorkDetail(workId);

  async function run(label: string, operation: () => Promise<unknown>) {
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
  }

  if (detail.loading) {
    return (
      <div className="mx-auto max-w-[1080px]">
        <Connecting what="Opening the run…" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-[1080px] pt-4">
        <Failure
          headline="This work could not be opened"
          detail={
            detail.error?.message ?? "The API returned nothing for this id."
          }
          consequence={
            detail.error?.isOffline
              ? "The run itself is unaffected - a worker executes it from the queue, not from this page."
              : undefined
          }
          action={
            <>
              <button
                type="button"
                onClick={detail.reload}
                className="button-ghost"
              >
                Try again
              </button>
              <Link to="/work" className="button-quiet">
                All work
              </Link>
            </>
          }
        />
      </div>
    );
  }

  const {
    work,
    tasks,
    events,
    artifacts,
    approvals,
    agents,
    memories,
    executionJob,
  } = detail.data;

  const agentOf = (id?: string) => agents.find((agent) => agent.id === id);
  const agentName = (id?: string) => agentOf(id)?.name ?? "Unassigned";

  const pendingApprovals = approvals.filter(
    (approval) => approval.status === "pending",
  );
  const completedCount = tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const inFlight = tasks.some(
    (task) => task.status === "running" || task.status === "ready",
  );

  const toolCalls = tasks.flatMap((task) =>
    (task.metadata.execution?.toolCalls ?? []).map((call) => ({
      call,
      task,
    })),
  );

  const resultTasks = [...tasks]
    .filter((task) => task.status === "completed" && task.result !== undefined)
    .sort(
      (left, right) =>
        new Date(left.completedAt ?? left.updatedAt).getTime() -
        new Date(right.completedAt ?? right.updatedAt).getTime(),
    );

  // The deliverable is the last task that finished.
  const finalResult = resultTasks.at(-1);
  const progress = tasks.length
    ? Math.round((completedCount / tasks.length) * 100)
    : 0;

  const failureMessage =
    typeof work.metadata.executionError === "string"
      ? work.metadata.executionError
      : typeof work.metadata.planningError === "string"
        ? work.metadata.planningError
        : undefined;

  // The run told as the sequence it actually was. A stage that did not happen
  // is not built, so a run with no tool calls has no tools chapter rather than
  // an empty one claiming the company reached for something.
  const steps: StoryStep[] = [];

  steps.push({
    key: "objective",
    label: "Objective",
    state: "done",
    tone: "tone-idle",
    body: (
      <>
        <p className="story-headline">{work.objective}</p>
        <p className="story-note">
          Received {formatRelativeTime(work.createdAt)} at {work.priority}{" "}
          priority.
        </p>
      </>
    ),
  });

  if (tasks.length > 0 || work.metadata.planningError) {
    steps.push({
      key: "plan",
      label: "Plan",
      state: tasks.length > 0 ? "done" : "idle",
      tone: tasks.length > 0 ? "tone-live" : "tone-error",
      body:
        tasks.length > 0 ? (
          <>
            <p className="story-headline">
              Broken into {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </p>
            <p className="story-lead">
              The planner decomposed the objective and named, for each task, the
              capabilities and tools it needs. Those requirements are what the
              delegator routes on.
            </p>
          </>
        ) : (
          <>
            <p className="story-headline">Planning did not produce a plan</p>
            <p className="story-lead">
              {String(work.metadata.planningError)}
            </p>
          </>
        ),
    });
  }

  const delegated = tasks.filter((task) => task.assignedAgentId);

  if (delegated.length > 0) {
    steps.push({
      key: "delegation",
      label: "Delegation",
      state: "done",
      tone: "tone-active",
      body: (
        <>
          <p className="story-headline">
            Routed to{" "}
            {new Set(delegated.map((task) => task.assignedAgentId)).size}{" "}
            {new Set(delegated.map((task) => task.assignedAgentId)).size === 1
              ? "specialist"
              : "specialists"}
          </p>

          <div className="mt-4 space-y-px">
            {delegated.map((task) => (
              <DelegationRow
                key={task.id}
                task={task}
                agent={agentOf(task.assignedAgentId)}
              />
            ))}
          </div>
        </>
      ),
    });
  }

  if (tasks.length > 0) {
    steps.push({
      key: "execution",
      label: "Execution",
      state: inFlight ? "live" : completedCount === tasks.length ? "done" : "idle",
      tone: inFlight ? "tone-active" : "tone-live",
      body: (
        <>
          <p className="story-headline">
            {completedCount} of {tasks.length} complete
          </p>

          {tasks.length > 0 && (
            <div className="progress-track mt-4">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
          )}

          <div className="mt-4 border-t border-[#161a21]">
            {tasks.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                index={index}
                agentName={agentName(task.assignedAgentId)}
                dependencyTitles={task.dependsOn
                  .map((id) => tasks.find((entry) => entry.id === id)?.title)
                  .filter((title): title is string => Boolean(title))}
              />
            ))}
          </div>
        </>
      ),
    });
  }

  if (toolCalls.length > 0) {
    steps.push({
      key: "tools",
      label: "Tools",
      state: "done",
      tone: "tone-active",
      body: (
        <>
          <p className="story-headline">
            {toolCalls.length} real tool{" "}
            {toolCalls.length === 1 ? "call" : "calls"}
          </p>
          <p className="story-lead">
            Each was validated against the tool's schema and re-checked against
            the calling agent's authorization before it ran.
          </p>

          <div className="mt-4 space-y-2">
            {toolCalls.map(({ call, task }, index) => (
              <div key={`${call.toolId}-${index}`} className="tool-call">
                <div className="flex flex-wrap items-center gap-2">
                  <Wrench size={12} className="text-[#84b4fb]" />

                  <span className="mono text-[10.5px] font-semibold text-[#f2f4f7]">
                    {call.toolId}
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
                    <div className="detail-label">Input</div>
                    <pre className="code-block mt-1">
                      {safeStringify(call.input, 2)}
                    </pre>
                  </div>

                  <div className="min-w-0">
                    <div className="detail-label">
                      {call.error ? "Error" : "Output"}
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
      ),
    });
  }

  if (approvals.length > 0) {
    steps.push({
      key: "decisions",
      label: "Decisions",
      state: pendingApprovals.length > 0 ? "live" : "done",
      tone: pendingApprovals.length > 0 ? "tone-warning" : "tone-live",
      body: (
        <>
          <p className="story-headline">
            {pendingApprovals.length > 0
              ? "This run is waiting on you"
              : `${approvals.length} human ${approvals.length === 1 ? "decision" : "decisions"}`}
          </p>

          <div className="mt-4 space-y-3">
            {approvals.map((approval) => (
              <ApprovalBlock
                key={approval.id}
                approval={approval}
                requestedBy={agentName(approval.agentId)}
                busy={Boolean(action)}
                onDecide={(decision) =>
                  run(decision, () =>
                    resolveApproval(approval.id, decision, RESOLVER_ID),
                  )
                }
              />
            ))}
          </div>
        </>
      ),
    });
  }

  // The final answer sits above the story, so the OUTPUT stage only earns a
  // place when there is more than one result and the intermediate ones say
  // something the deliverable alone does not.
  if (resultTasks.length > 1) {
    steps.push({
      key: "output",
      label: "Output",
      state: "done",
      tone: "tone-live",
      body: (
        <>
          <p className="story-headline">
            What each step returned
          </p>

          <div className="mt-4 space-y-3">
            {resultTasks.map((task) => (
              <div key={task.id} className="callout">
                <div className="detail-label mb-1.5">
                  {task.title} · {agentName(task.assignedAgentId)}
                </div>
                {excerptOf(task.result, 300)}
              </div>
            ))}
          </div>
        </>
      ),
    });
  }

  if (artifacts.length > 0) {
    steps.push({
      key: "artifact",
      label: "Artifact",
      state: "done",
      tone: "tone-live",
      body: (
        <>
          <p className="story-headline">
            {artifacts.length} durable{" "}
            {artifacts.length === 1 ? "output" : "outputs"}
          </p>
          <p className="story-lead">
            Stored the moment the task producing it completed, so the result
            outlives the run that made it.
          </p>

          <div className="workbench mt-4">
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
      ),
    });
  }

  if (memories.length > 0) {
    steps.push({
      key: "memory",
      label: "Memory",
      state: "done",
      tone: "tone-active",
      body: (
        <>
          <p className="story-headline">
            {memories.length} {memories.length === 1 ? "memory" : "memories"}{" "}
            written
          </p>
          <p className="story-lead">
            What this run leaves behind for the next one. Agents retrieve from
            here before starting related work.
          </p>

          <div className="mt-4 space-y-2">
            {memories.map((memory: MemoryItem) => (
              <div key={memory.id} className="callout">
                <div className="detail-label mb-1.5">
                  {memory.type} · {formatRelativeTime(memory.createdAt)}
                </div>
                {memory.content}
              </div>
            ))}
          </div>

          <Link to="/brain" className="button-quiet mt-3 inline-flex">
            Everything the company knows
          </Link>
        </>
      ),
    });
  }

  if (events.length > 0) {
    steps.push({
      key: "record",
      label: "Record",
      state: "done",
      tone: "tone-idle",
      body: (
        <>
          <p className="story-headline">
            {events.length} recorded {events.length === 1 ? "event" : "events"}
          </p>

          <div className="timeline mt-2 !px-0">
            {[...events].reverse().map((event) => {
              const described = describeEvent(event);

              return (
                <div key={event.id} className="timeline-entry">
                  <span className={`timeline-dot ${described.tone}`} />

                  <div className="min-w-0 flex-1 pb-4">
                    <div className="text-[11px] leading-[1.5] text-[#a7b0bd]">
                      {described.title}
                    </div>

                    {described.detail && (
                      <div className="mt-1 text-[10px] leading-[1.55] text-[#6f7887]">
                        {described.detail}
                      </div>
                    )}

                    <div className="mono mt-1.5 text-[9px] text-[#3a4250]">
                      {formatRelativeTime(event.timestamp)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ),
    });
  }

  return (
    <div className="mx-auto max-w-[1080px] fade-up">
      <Link to="/work" className="button-quiet mb-5 inline-flex">
        <ArrowLeft size={12} />
        All work
      </Link>

      <header className="border-b border-[#161a21] pb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="t-eyebrow mb-3">The run</div>

            <h2 className="max-w-[30ch] text-[clamp(22px,3.2vw,34px)] font-[660] leading-[1.14] tracking-[-0.032em] text-[#f2f4f7]">
              {work.objective}
            </h2>
          </div>

          <StatusPill
            tone={workStatusTone(work.status)}
            pulse={work.status === "executing"}
          >
            {statusLabel(work.status)}
          </StatusPill>
        </div>

        <div className="dispatch-meta !mt-7">
          <Fact label="Tasks" value={tasks.length === 0 ? "—" : `${completedCount}/${tasks.length}`} />
          <Fact
            label="Ran for"
            value={formatDuration(work.startedAt, work.completedAt)}
          />
          <Fact label="Priority" value={work.priority} />
          <Fact label="Tool calls" value={toolCalls.length} />
          <Fact label="Artifacts" value={artifacts.length} />
        </div>

        {failureMessage && (
          <div className="mt-6">
            {work.metadata.interrupted ? (
              <div className="callout callout-warning">
                <div className="detail-label mb-1.5">Interrupted</div>
                {failureMessage}
                <div className="mt-2 text-[10.5px] text-[#c9a06a]">
                  The process stopped, not the work. Completed tasks were kept
                  and it can be resumed from where it stopped.
                </div>
              </div>
            ) : (
              <Failure
                headline="Work failed"
                detail={failureMessage}
                consequence="Nothing was lost. Completed tasks are kept, and a retry resumes from the first task that did not finish."
              />
            )}
          </div>
        )}

        {executionJob?.lastError && executionJob.status === "queued" && (
          <div className="callout callout-warning mt-4">
            <div className="detail-label mb-1.5">
              Attempt {executionJob.attempts} did not finish
            </div>
            {executionJob.lastError} It is queued to be tried again.
          </div>
        )}

        {actionError && (
          <div className="mt-4">
            <Failure
              headline="That action did not go through"
              detail={actionError}
              consequence="Nothing was changed."
            />
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {tasks.length === 0 &&
            (work.status === "queued" || work.status === "planning") && (
              <button
                type="button"
                disabled={Boolean(action)}
                onClick={() => run("plan", () => planWork(work.id))}
                className="button-primary"
              >
                <Play size={13} />
                {action === "plan" ? "Planning…" : "Build the plan"}
              </button>
            )}

          {executionJob?.status === "queued" && (
            <span className="running-indicator">
              <LoaderCircle size={13} className="spin-slow" />
              {executionJob.attempts > 0
                ? `Requeued for attempt ${executionJob.attempts + 1}`
                : "Queued for a worker"}
            </span>
          )}

          {executionJob?.status === "running" && (
            <span className="running-indicator">
              <LoaderCircle size={13} className="spin-slow" />
              Running on {executionJob.claimedBy ?? "a worker"}
            </span>
          )}

          {!executionJob && tasks.length > 0 && inFlight && (
            <span className="running-indicator">
              <LoaderCircle size={13} className="spin-slow" />
              Executing
            </span>
          )}

          {tasks.length > 0 &&
            !inFlight &&
            !executionJob &&
            (work.status === "queued" || work.status === "executing") && (
              <button
                type="button"
                disabled={Boolean(action)}
                onClick={() => run("execute", () => executeWork(work.id))}
                className="button-primary"
              >
                <Play size={13} />
                {action === "execute"
                  ? "Starting…"
                  : work.status === "executing"
                    ? "Resume execution"
                    : "Execute"}
              </button>
            )}

          {work.status === "failed" && (
            <button
              type="button"
              disabled={Boolean(action)}
              onClick={() =>
                run("retry", async () => {
                  const result = await retryWork(work.id);
                  if (result.mode === "replan") await planWork(work.id);
                  await executeWork(work.id);
                })
              }
              className="button-primary"
            >
              <RotateCcw size={13} />
              {action === "retry"
                ? "Retrying…"
                : work.metadata.interrupted
                  ? "Resume this work"
                  : "Retry this work"}
            </button>
          )}

          <button
            type="button"
            onClick={detail.reload}
            className="button-quiet"
            disabled={Boolean(action)}
          >
            <RefreshCw
              size={12}
              className={detail.refreshing ? "spin-slow" : undefined}
            />
            Refresh
          </button>
        </div>
      </header>

      {/* The answer, before any of the machinery that produced it. */}
      {finalResult && (
        <div className="mt-7">
          <div className="delivery">
            <div className="delivery-eyebrow">What the company produced</div>

            <div className="delivery-body">
              <ResultBody value={finalResult.result} />
            </div>

            <div className="delivery-foot">
              <span className="t-machine">
                {agentName(finalResult.assignedAgentId)}
              </span>
              <span className="t-machine">{finalResult.title}</span>
              <span className="t-machine">
                {formatRelativeTime(
                  finalResult.completedAt ?? finalResult.updatedAt,
                )}
              </span>
            </div>
          </div>
        </div>
      )}

      {tasks.length === 0 && !work.metadata.planningError && (
        <Quiet
          line="This objective has no plan yet."
          detail="Nothing has been decomposed, delegated or executed. Build the plan and every stage of the run appears here as it happens."
        />
      )}

      <div className="story">
        {steps.map((step, index) => (
          <section
            key={step.key}
            className={`story-step ${step.tone} story-step-${step.state}`}
            style={{ "--step-index": index } as React.CSSProperties}
          >
            <div className="story-label">
              <div className="story-label-name">{step.label}</div>
              <div className="story-label-index">
                {String(index + 1).padStart(2, "0")}
              </div>
            </div>

            <div className="story-spine" aria-hidden="true" />

            <div className="story-body">{step.body}</div>
          </section>
        ))}
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

interface StoryStep {
  key: string;
  label: string;
  /** done | live | idle - drives the node on the spine. */
  state: "done" | "live" | "idle";
  tone: string;
  body: ReactNode;
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
 * Who got a task and why the delegator picked them. The reason matters: a
 * partial capability match means the company did the work with the closest
 * available specialist rather than the right one, and that is worth knowing
 * before trusting the result.
 */
function DelegationRow({
  task,
  agent,
}: {
  task: TaskItem;
  agent?: AgentSummary;
}) {
  const delegation = task.metadata.delegation;

  return (
    <div className="presence-row">
      <span className="presence-mark tone-active">
        {agent ? (
          <AgentMark
            agentId={agent.id}
            capabilities={agent.capabilities}
            tools={agent.toolIds.length}
            type={agent.type}
            size={22}
          />
        ) : (
          <span className="text-[11px]">?</span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[12px] font-semibold text-[#f2f4f7]">
            {agent?.name ?? "Unassigned"}
          </span>

          {agent && (
            <span className="roster-role">{profileOf(agent).label}</span>
          )}
        </span>

        <span className="mt-1 block text-[10.5px] leading-[1.55] text-[#6f7887]">
          {task.title}
        </span>

        {delegation?.selectionReason && (
          <span className="mt-1 block text-[10px] leading-[1.55] text-[#535b68]">
            {delegation.selectionReason}
          </span>
        )}

        {delegation?.capabilityFit === "partial" && (
          <span className="mt-1.5 block text-[10px] text-[#c9a06a]">
            Closest available match — does not hold{" "}
            {(delegation.unmatchedCapabilities ?? []).join(", ")}.
          </span>
        )}
      </span>

      <StatusPill tone={taskStatusTone(task.status)}>
        {statusLabel(task.status)}
      </StatusPill>
    </div>
  );
}

/**
 * One approval, stated the way the Approvals surface states it: what is being
 * asked, why it stopped, and what happens either way. A decision the person
 * has already made keeps the record but loses the buttons.
 */
function ApprovalBlock({
  approval,
  requestedBy,
  busy,
  onDecide,
}: {
  approval: ApprovalItem;
  requestedBy: string;
  busy: boolean;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  const pending = approval.status === "pending";

  return (
    <div className={pending ? "approval-card" : "callout"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-[#f2f4f7]">
            {approval.action}
          </div>
          <div className="t-machine mt-1">{approval.resource}</div>
        </div>

        <StatusPill
          tone={
            approval.status === "approved"
              ? "live"
              : approval.status === "rejected"
                ? "error"
                : "warning"
          }
          pulse={pending}
        >
          {approval.status}
        </StatusPill>
      </div>

      <p className="mt-3 text-[11.5px] leading-[1.7] text-[#a7b0bd]">
        {approval.reason}
      </p>

      <div className="t-machine mt-2.5">
        requested by {requestedBy} · {formatRelativeTime(approval.createdAt)}
        {approval.resolvedAt &&
          ` · resolved ${formatRelativeTime(approval.resolvedAt)}`}
      </div>

      {pending && (
        <div className="mt-4 flex flex-wrap gap-2">
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
      )}
    </div>
  );
}

function TaskRow({
  task,
  index,
  agentName,
  dependencyTitles,
}: {
  task: TaskItem;
  index: number;
  agentName: string;
  dependencyTitles: string[];
}) {
  const [open, setOpen] = useState(false);
  const toolCalls = task.metadata.execution?.toolCalls ?? [];
  const requiredTools = task.metadata.routing?.requiredTools ?? [];
  const hasResult = task.result !== undefined && task.result !== "";

  return (
    <div className="border-b border-[#161a21] last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="task-row !px-0"
        aria-expanded={open}
      >
        <span className="task-index mono">
          {String(index + 1).padStart(2, "0")}
        </span>

        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-[#f2f4f7]">
              {task.title}
            </span>

            <StatusPill
              tone={taskStatusTone(task.status)}
              pulse={task.status === "running"}
            >
              {statusLabel(task.status)}
            </StatusPill>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <span className="mono text-[9.5px] text-[#6f7887]">
              {agentName}
            </span>

            {requiredTools.map((tool) => (
              <Chip key={tool} tone="active" title="Required tool">
                <Wrench size={9} />
                {tool}
              </Chip>
            ))}

            {toolCalls.length > 0 && (
              <span className="mono text-[9px] text-[#535b68]">
                {toolCalls.length} tool{" "}
                {toolCalls.length === 1 ? "call" : "calls"}
              </span>
            )}

            {task.startedAt && task.completedAt && (
              <span className="mono text-[9px] text-[#535b68]">
                {formatDuration(task.startedAt, task.completedAt)}
              </span>
            )}

            {dependencyTitles.length > 0 && (
              <span className="mono text-[9px] text-[#535b68]">
                after {dependencyTitles.join(", ")}
              </span>
            )}
          </div>
        </div>

        <ChevronRight
          size={14}
          className={`shrink-0 text-[#535b68] transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="task-detail !pl-[34px] !pr-0">
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
              <div className="detail-label">Result</div>
              <div className="result-block mt-2">
                <ResultBody value={task.result} />
              </div>
            </div>
          )}

          {!hasResult && !task.metadata.execution?.error && (
            <p className="mt-4 text-[10.5px] text-[#535b68]">
              {task.status === "waiting"
                ? "This task is holding for an approval decision."
                : "This task has not produced a result yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
