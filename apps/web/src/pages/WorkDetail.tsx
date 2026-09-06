import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  FileOutput,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  executeWork,
  formatDuration,
  formatRelativeTime,
  fetchWorkDetail,
  planWork,
  resolveApproval,
  retryWork,
  type TaskItem,
  type WorkDetail as WorkDetailData,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import { describeEvent, safeStringify, summarizeValue } from "../lib/events";

import {
  Chip,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  StatusPill,
  TimeStamp,
} from "../components/primitives";

import {
  statusLabel,
  taskStatusTone,
  workStatusTone,
} from "../lib/tone";

// No auth yet, so a decision is attributed to the seeded development
// requester rather than inventing an identity the backend cannot verify.
const RESOLVER_ID = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

/** Work that can still change is watched closely; settled work is not. */
const LIVE_POLL_MS = 4_000;
const SETTLED_POLL_MS = 30_000;

export default function WorkDetail() {
  const { workId = "" } = useParams();
  const [action, setAction] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [pollMs, setPollMs] = useState(LIVE_POLL_MS);

  const detail = useResource<WorkDetailData>(
    useCallback(() => fetchWorkDetail(workId), [workId]),
    { pollMs, enabled: Boolean(workId) },
  );

  const status = detail.data?.work.status;

  useEffect(() => {
    if (!status) return;

    setPollMs(
      status === "completed" || status === "failed" || status === "cancelled"
        ? SETTLED_POLL_MS
        : LIVE_POLL_MS,
    );
  }, [status]);

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
      <div className="mx-auto max-w-[1180px]">
        <Panel eyebrow="Work" title="Loading">
          <Skeleton rows={7} />
        </Panel>
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="mx-auto max-w-[1180px]">
        <Panel>
          <ErrorState
            message={detail.error?.message ?? "This work item could not be loaded."}
            offline={detail.error?.isOffline}
            onRetry={detail.reload}
          />
        </Panel>
      </div>
    );
  }

  const { work, tasks, events, artifacts, approvals, agents } = detail.data;
  const agentName = (id?: string) =>
    agents.find((agent) => agent.id === id)?.name ?? "Unassigned";

  const pendingApprovals = approvals.filter(
    (approval) => approval.status === "pending",
  );
  const completedCount = tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const progress = tasks.length
    ? Math.round((completedCount / tasks.length) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-[1180px] fade-up">
      <Link to="/work" className="button-quiet mb-4 inline-flex">
        <ArrowLeft size={12} />
        All work
      </Link>

      <Panel
        eyebrow="Objective"
        title={
          <span className="block text-[14px] leading-[1.6] font-normal text-slate-200">
            {work.objective}
          </span>
        }
        action={
          <StatusPill
            tone={workStatusTone(work.status)}
            pulse={work.status === "executing"}
          >
            {statusLabel(work.status)}
          </StatusPill>
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <TimeStamp
            iso={work.createdAt}
            relative={`created ${formatRelativeTime(work.createdAt)}`}
          />

          {work.startedAt && work.completedAt && (
            <span className="mono text-[9.5px] text-slate-500">
              ran for {formatDuration(work.startedAt, work.completedAt)}
            </span>
          )}

          <span className="mono text-[9.5px] uppercase tracking-[0.1em] text-slate-600">
            {work.priority} priority
          </span>

          {tasks.length > 0 && (
            <span className="mono text-[9.5px] text-slate-500">
              {completedCount}/{tasks.length} tasks complete
            </span>
          )}
        </div>

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

        {typeof work.metadata.executionError === "string" && (
          <div className="callout callout-error mt-4">
            {work.metadata.executionError}
          </div>
        )}

        {typeof work.metadata.planningError === "string" && (
          <div className="callout callout-error mt-4">
            {work.metadata.planningError}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
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

          {tasks.length > 0 &&
            (work.status === "queued" || work.status === "executing") && (
              <button
                type="button"
                disabled={Boolean(action)}
                onClick={() => run("execute", () => executeWork(work.id))}
                className="button-primary"
              >
                <Play size={13} />
                {action === "execute" ? "Executing…" : "Execute"}
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
              {action === "retry" ? "Retrying…" : "Retry this work"}
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

        {actionError && (
          <div className="callout callout-error mt-4">{actionError}</div>
        )}
      </Panel>

      {pendingApprovals.length > 0 && (
        <Panel
          className="mt-4"
          eyebrow="Governance"
          title="This work is waiting on your decision"
        >
          <div className="space-y-3">
            {pendingApprovals.map((approval) => (
              <div key={approval.id} className="approval-card">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={16} className="mt-0.5 text-amber-300" />

                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-slate-200">
                      {approval.action}
                    </div>

                    <p className="mt-1.5 text-[11px] leading-[1.65] text-slate-400">
                      {approval.reason}
                    </p>

                    <div className="mt-2 text-[10px] text-slate-500">
                      Requested by {agentName(approval.agentId)} ·{" "}
                      {formatRelativeTime(approval.createdAt)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={Boolean(action)}
                    onClick={() =>
                      run("approve", () =>
                        resolveApproval(approval.id, "approve", RESOLVER_ID),
                      )
                    }
                    className="button-ghost button-approve"
                  >
                    Approve and continue
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(action)}
                    onClick={() =>
                      run("reject", () =>
                        resolveApproval(approval.id, "reject", RESOLVER_ID),
                      )
                    }
                    className="button-ghost button-reject"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Panel eyebrow="Plan" title="Tasks and execution" padded={false}>
            {tasks.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="No plan yet"
                description="The planner has not produced tasks for this objective. Build the plan above to see them."
              />
            ) : (
              <div className="stack-list">
                {tasks.map((task, index) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    index={index}
                    agentName={agentName(task.assignedAgentId)}
                    dependencyTitles={task.dependsOn
                      .map(
                        (id) => tasks.find((entry) => entry.id === id)?.title,
                      )
                      .filter((title): title is string => Boolean(title))}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel eyebrow="Output" title="Artifacts" padded={false}>
            {artifacts.length === 0 ? (
              <EmptyState
                icon={FileOutput}
                title="No artifacts yet"
                description="Each completed task stores its result as a durable artifact."
              />
            ) : (
              <div className="stack-list">
                {artifacts.map((artifact) => (
                  <div key={artifact.id} className="px-[18px] py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="text-[12px] font-semibold text-slate-200">
                          {artifact.name}
                        </div>

                        <div className="mt-1 text-[10.5px] text-slate-500">
                          {artifact.description}
                        </div>
                      </div>

                      <Chip tone="live">{artifact.type}</Chip>
                    </div>

                    {artifact.metadata.content !== undefined && (
                      <pre className="code-block mt-3">
                        {typeof artifact.metadata.content === "string"
                          ? artifact.metadata.content
                          : safeStringify(artifact.metadata.content, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <Panel
          eyebrow="Timeline"
          title="What actually happened"
          padded={false}
          className="self-start"
        >
          {events.length === 0 ? (
            <EmptyState
              icon={Boxes}
              title="No events recorded"
              description="Events are written as the work progresses."
            />
          ) : (
            <div className="timeline">
              {[...events].reverse().map((event) => {
                const described = describeEvent(event);

                return (
                  <div key={event.id} className="timeline-entry">
                    <span className={`timeline-dot ${described.tone}`} />

                    <div className="min-w-0 flex-1 pb-4">
                      <div className="text-[11px] leading-[1.5] text-slate-300">
                        {described.title}
                      </div>

                      {described.detail && (
                        <div className="mt-1 text-[10px] leading-[1.55] text-slate-600">
                          {described.detail}
                        </div>
                      )}

                      <div className="mt-1.5 mono text-[9px] text-slate-700">
                        {formatRelativeTime(event.timestamp)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
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
  const delegation = task.metadata.delegation;
  const result =
    typeof task.result === "string" ? task.result : safeStringify(task.result, 2);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="task-row"
        aria-expanded={open}
      >
        <span className="task-index mono">{String(index + 1).padStart(2, "0")}</span>

        <div className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-slate-200">
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
            <span className="mono text-[9.5px] text-slate-500">{agentName}</span>

            {requiredTools.map((tool) => (
              <Chip key={tool} tone="active" title="Required tool">
                <Wrench size={9} />
                {tool}
              </Chip>
            ))}

            {toolCalls.length > 0 && (
              <span className="mono text-[9px] text-slate-600">
                {toolCalls.length} tool{" "}
                {toolCalls.length === 1 ? "call" : "calls"}
              </span>
            )}

            {dependencyTitles.length > 0 && (
              <span className="mono text-[9px] text-slate-600">
                after {dependencyTitles.join(", ")}
              </span>
            )}
          </div>
        </div>

        <ChevronRight
          size={14}
          className={`shrink-0 text-slate-600 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="task-detail">
          <p className="text-[11.5px] leading-[1.7] text-slate-400">
            {task.description}
          </p>

          {delegation?.selectionReason && (
            <div className="mt-4">
              <div className="detail-label">Why this agent</div>
              <p className="mt-1.5 text-[11px] leading-[1.65] text-slate-500">
                {delegation.selectionReason}
              </p>

              {delegation.capabilityFit === "partial" && (
                <div className="callout callout-warning mt-2.5">
                  Closest available match — this agent does not hold{" "}
                  {(delegation.unmatchedCapabilities ?? []).join(", ")}.
                </div>
              )}
            </div>
          )}

          {toolCalls.length > 0 && (
            <div className="mt-4">
              <div className="detail-label">Tool calls</div>

              <div className="mt-2 space-y-2">
                {toolCalls.map((call, callIndex) => (
                  <div key={`${call.toolId}-${callIndex}`} className="tool-call">
                    <div className="flex items-center gap-2">
                      <Wrench size={12} className="text-cyan-300" />

                      <span className="mono text-[10.5px] font-semibold text-slate-200">
                        {call.toolId}
                      </span>

                      <StatusPill
                        tone={call.status === "completed" ? "live" : "error"}
                      >
                        {call.status}
                      </StatusPill>
                    </div>

                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      <div>
                        <div className="detail-label">Input</div>
                        <pre className="code-block mt-1">
                          {safeStringify(call.input, 2)}
                        </pre>
                      </div>

                      <div>
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
            </div>
          )}

          {task.metadata.execution?.error && (
            <div className="callout callout-error mt-4">
              {task.metadata.execution.error.message}
            </div>
          )}

          {result && (
            <div className="mt-4">
              <div className="detail-label">Result</div>
              <div className="result-block mt-2">{result}</div>
            </div>
          )}

          {!result && !task.metadata.execution?.error && (
            <p className="mt-4 text-[10.5px] text-slate-600">
              {summarizeValue(task.status) === "waiting"
                ? "This task is holding for an approval decision."
                : "This task has not produced a result yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
