import {
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  FileOutput,
  GitBranch,
  History,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createWork,
  executeWork,
  fetchOverview,
  formatRelativeTime,
  planWork,
  type CompanyOverview,
  type WorkItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  EmptyState,
  ErrorState,
  Metric,
  Panel,
  Skeleton,
  StatusPill,
  TimeStamp,
} from "../components/primitives";

import {
  presenceTone,
  statusLabel,
  workStatusTone,
} from "../lib/tone";

import { describeEvent } from "../lib/events";

/**
 * The launch pipeline mirrors the real API calls, one stage per call. Nothing
 * here is timed or simulated - a stage advances only when the request behind
 * it actually returns, which is why planning visibly takes as long as the
 * model takes. Once execution is scheduled the page hands off to the work
 * detail view, which watches the same rows the executor is writing.
 */
type LaunchStage = "idle" | "creating" | "planning" | "executing" | "done";

const stageCopy: Record<Exclude<LaunchStage, "idle">, string> = {
  creating: "Recording the objective",
  planning: "Atlas is building the work plan",
  executing: "Handing the plan to the specialists",
  done: "Execution is under way",
};

const suggestions = [
  "Calculate our total monthly operating cost from salaries 48200, cloud 9350, lease 12500 and licences 3875, then explain what it means for runway.",
  "Tell me what day of the week 25 December 2027 falls on and how many days away it is.",
  "Draft a one-page competitor brief covering positioning, pricing and the gap we should attack.",
];

export default function Command() {
  const navigate = useNavigate();

  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(24), []),
    { pollMs: 15_000 },
  );

  const [objective, setObjective] = useState("");
  const [priority, setPriority] = useState<WorkItem["priority"]>("normal");
  const [stage, setStage] = useState<LaunchStage>("idle");
  const [launchedWorkId, setLaunchedWorkId] = useState<string>();
  const [launchError, setLaunchError] = useState<string>();

  const busy = stage !== "idle" && stage !== "done";

  async function launch() {
    const trimmed = objective.trim();
    if (!trimmed || busy) return;

    setLaunchError(undefined);
    setLaunchedWorkId(undefined);
    setStage("creating");

    try {
      const work = await createWork(trimmed, priority);
      setLaunchedWorkId(work.id);

      setStage("planning");
      await planWork(work.id);

      setStage("executing");
      await executeWork(work.id);

      setStage("done");
      setObjective("");
      overview.reload();

      // Execution now runs in the background, so the useful thing to show is
      // the live work view rather than a spinner on this page.
      navigate(`/work/${work.id}`);
    } catch (error) {
      setLaunchError((error as Error).message);
      setStage("idle");
      overview.reload();
    }
  }

  const data = overview.data;
  const activeWork = data?.work.active ?? [];
  const workingAgents =
    data?.agents.filter((agent) => agent.presence === "working") ?? [];
  const pendingApprovals = data?.approvals ?? [];

  return (
    <div className="mx-auto max-w-[1420px] fade-up">
      <div className="mb-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/15 bg-cyan-400/[0.045] px-3 py-1.5">
          <span
            className={`pill-dot ${overview.error ? "tone-error" : "tone-live"}`}
          />
          <span className="mono text-[9px] font-medium uppercase tracking-[0.16em] text-cyan-300">
            {overview.error ? "Control plane offline" : "Control plane online"}
          </span>
        </div>

        <h2 className="mt-3.5 max-w-[820px] text-[28px] font-semibold leading-[1.15] tracking-[-0.04em] text-slate-100 max-sm:text-[22px]">
          Direct the company, not another chatbot.
        </h2>

        <p className="mt-2 max-w-[660px] text-[12px] leading-[1.6] text-slate-400">
          State an objective. UNI-OFFICE plans the work, routes each task to the
          specialist that holds the right tools, and keeps consequential steps
          behind your approval.
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Active work"
          tone={activeWork.length > 0 ? "active" : "idle"}
          value={overview.loading ? "—" : activeWork.length}
          detail={`${data?.work.total ?? 0} objectives all time`}
        />

        <Metric
          label="Agents working"
          tone={workingAgents.length > 0 ? "active" : "live"}
          value={overview.loading ? "—" : workingAgents.length}
          detail={`${data?.agents.length ?? 0} in the workforce`}
        />

        <Metric
          label="Pending approvals"
          tone={pendingApprovals.length > 0 ? "warning" : "idle"}
          value={overview.loading ? "—" : pendingApprovals.length}
          detail="Require a human decision"
        />

        <Metric
          label="Tool calls"
          tone="live"
          value={
            overview.loading
              ? "—"
              : (data?.tools.reduce((total, tool) => total + tool.callCount, 0) ?? 0)
          }
          detail="In recent activity"
        />
      </div>
      <div className="command-grid">
        <div className="min-w-0 space-y-4">
          <Panel
            eyebrow="Command"
            title="New company objective"
            action={
              <span className="mono text-[9px] uppercase tracking-[0.14em] text-slate-600">
                {busy ? "Running" : "Ready"}
              </span>
            }
          >
            <textarea
              id="work-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              disabled={busy}
              className="command-textarea min-h-[132px] w-full bg-transparent text-[15px] leading-[1.7] text-slate-100 placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="What should your company accomplish?"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => setObjective(suggestion)}
                  className="suggestion-chip"
                  title={suggestion}
                >
                  {suggestion.slice(0, 46)}…
                </button>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#1b252e] pt-4">
              <label className="flex items-center gap-2.5">
                <span className="mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Priority
                </span>

                <select
                  value={priority}
                  disabled={busy}
                  onChange={(event) =>
                    setPriority(event.target.value as WorkItem["priority"])
                  }
                  className="select-control"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>

              <button
                type="button"
                onClick={launch}
                disabled={!objective.trim() || busy}
                className="button-primary"
              >
                {busy ? (
                  <LoaderCircle size={14} className="spin-slow" />
                ) : (
                  <Zap size={14} />
                )}
                {busy ? "Working…" : "Launch work"}
              </button>
            </div>
          </Panel>

          {stage !== "idle" && (
            <LaunchPipeline
              stage={stage}
              workId={launchedWorkId}
              error={launchError}
              onOpen={() =>
                launchedWorkId && navigate(`/work/${launchedWorkId}`)
              }
            />
          )}

          {launchError && stage === "idle" && (
            <Panel eyebrow="Launch" title="The objective could not be completed">
              <p className="text-[12px] leading-[1.7] text-slate-400">
                {launchError}
              </p>

              {launchedWorkId && (
                <Link
                  to={`/work/${launchedWorkId}`}
                  className="button-ghost mt-4 inline-flex"
                >
                  Inspect what happened
                  <ArrowRight size={13} />
                </Link>
              )}
            </Panel>
          )}

          <Panel
            eyebrow="Execution"
            title="Work in flight"
            action={
              <Link to="/work" className="button-quiet">
                All work
                <ArrowRight size={12} />
              </Link>
            }
            padded={false}
          >
            {overview.loading ? (
              <div className="p-[18px]">
                <Skeleton rows={3} />
              </div>
            ) : overview.error ? (
              <ErrorState
                message={overview.error.message}
                offline={overview.error.isOffline}
                onRetry={overview.reload}
              />
            ) : activeWork.length === 0 ? (
              <EmptyState
                icon={GitBranch}
                title="Nothing is executing right now"
                description="Launch an objective above and the plan, its tasks and every tool call will appear here as they happen."
              />
            ) : (
              <div className="stack-list">
                {activeWork.map((work) => (
                  <Link
                    key={work.id}
                    to={`/work/${work.id}`}
                    className="row-link"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p className="line-clamp-2 text-[12.5px] leading-[1.6] text-slate-200">
                        {work.objective}
                      </p>

                      <StatusPill
                        tone={workStatusTone(work.status)}
                        pulse={work.status === "executing"}
                      >
                        {statusLabel(work.status)}
                      </StatusPill>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <TimeStamp
                        iso={work.createdAt}
                        relative={formatRelativeTime(work.createdAt)}
                      />

                      <span className="mono text-[9px] uppercase tracking-[0.1em] text-slate-600">
                        {work.priority}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="History"
            title="Recently finished"
            padded={false}
          >
            {overview.loading ? (
              <div className="p-[18px]">
                <Skeleton rows={2} />
              </div>
            ) : (data?.work.recentlyCompleted.length ?? 0) === 0 ? (
              <EmptyState
                icon={History}
                title="No completed work yet"
                description="Finished objectives land here with their results, artifacts and the memory they contributed."
              />
            ) : (
              <div className="stack-list">
                {data!.work.recentlyCompleted.map((work) => (
                  <Link
                    key={work.id}
                    to={`/work/${work.id}`}
                    className="row-link"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <p className="line-clamp-1 text-[11.5px] leading-[1.6] text-slate-400">
                        {work.objective}
                      </p>

                      <StatusPill tone={workStatusTone(work.status)}>
                        {statusLabel(work.status)}
                      </StatusPill>
                    </div>

                    <TimeStamp
                      iso={work.completedAt ?? work.updatedAt}
                      relative={formatRelativeTime(
                        work.completedAt ?? work.updatedAt,
                      )}
                    />
                  </Link>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel
            eyebrow="Workforce"
            title="Agent presence"
            action={
              <Link to="/agents" className="button-quiet">
                Manage
              </Link>
            }
            padded={false}
          >
            {overview.loading ? (
              <div className="p-[18px]">
                <Skeleton rows={4} />
              </div>
            ) : (data?.agents.length ?? 0) === 0 ? (
              <EmptyState
                icon={Bot}
                title="No agents registered"
                description="Seed the development workforce to give this organization a roster."
              />
            ) : (
              <div className="stack-list">
                {data!.agents.map((agent) => (
                  <Link
                    key={agent.agentId}
                    to="/agents"
                    className="row-link !py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`agent-mark ${presenceTone(agent.presence) === "active" ? "tone-active" : presenceTone(agent.presence)}`}
                      >
                        {agent.name.slice(0, 1)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[11.5px] font-semibold text-slate-200">
                            {agent.name}
                          </span>

                          <span className="mono text-[8.5px] uppercase tracking-[0.1em] text-slate-600">
                            {agent.type}
                          </span>
                        </div>

                        <div className="mt-1 truncate text-[10px] text-slate-500">
                          {agent.activeTask
                            ? agent.activeTask.title
                            : `${agent.toolIds.length} tools · ${agent.completedTaskCount} tasks done`}
                        </div>
                      </div>

                      <StatusPill
                        tone={presenceTone(agent.presence)}
                        pulse={agent.presence === "working"}
                      >
                        {agent.presence}
                      </StatusPill>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="Governance"
            title="Waiting on you"
            action={
              pendingApprovals.length > 0 ? (
                <Link to="/approvals" className="button-quiet">
                  Review
                </Link>
              ) : undefined
            }
            padded={false}
          >
            {overview.loading ? (
              <div className="p-[18px]">
                <Skeleton rows={2} />
              </div>
            ) : pendingApprovals.length === 0 ? (
              <EmptyState
                icon={ShieldCheck}
                title="No approvals pending"
                description="Tasks the planner marks as consequential pause here before they run."
              />
            ) : (
              <div className="stack-list">
                {pendingApprovals.slice(0, 4).map((approval) => (
                  <Link
                    key={approval.id}
                    to="/approvals"
                    className="row-link !py-3.5"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="pill-dot tone-warning mt-1.5" />

                      <div className="min-w-0">
                        <div className="text-[11.5px] font-semibold text-slate-200">
                          {approval.action}
                        </div>

                        <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.55] text-slate-500">
                          {approval.reason}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            eyebrow="Stream"
            title="Live activity"
            action={
              <Link to="/activity" className="button-quiet">
                Full log
              </Link>
            }
            padded={false}
          >
            {overview.loading ? (
              <div className="p-[18px]">
                <Skeleton rows={5} />
              </div>
            ) : (data?.activity.length ?? 0) === 0 ? (
              <EmptyState
                icon={Boxes}
                title="The company has not acted yet"
                description="Every plan, delegation, tool call and approval is recorded here."
              />
            ) : (
              <div className="scroll-area max-h-[340px] p-2">
                {data!.activity.slice(0, 14).map((event) => {
                  const described = describeEvent(event);

                  return (
                    <div key={event.id} className="activity-line">
                      <span className={`pill-dot ${described.tone}`} />

                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-slate-300">
                          {described.title}
                        </div>

                        {described.detail && (
                          <div className="mt-0.5 truncate text-[9.5px] text-slate-600">
                            {described.detail}
                          </div>
                        )}
                      </div>

                      <span className="mono shrink-0 text-[9px] text-slate-600">
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </aside>
      </div>

    </div>
  );
}

function LaunchPipeline({
  stage,
  workId,
  error,
  onOpen,
}: {
  stage: LaunchStage;
  workId?: string;
  error?: string;
  onOpen: () => void;
}) {
  const order: Array<Exclude<LaunchStage, "idle">> = [
    "creating",
    "planning",
    "executing",
    "done",
  ];
  const currentIndex = order.indexOf(stage as Exclude<LaunchStage, "idle">);

  return (
    <Panel
      eyebrow="Pipeline"
      title={
        stage === "done"
          ? "Execution finished"
          : error
            ? "Execution stopped"
            : stageCopy[stage as Exclude<LaunchStage, "idle">]
      }
      action={
        workId ? (
          <button type="button" onClick={onOpen} className="button-quiet">
            Open work
            <ArrowRight size={12} />
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-2 sm:grid-cols-4">
        {order.map((entry, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex && stage !== "done";
          const finished = stage === "done";

          return (
            <div
              key={entry}
              className={[
                "pipeline-step",
                done || finished
                  ? "pipeline-step-done"
                  : active
                    ? "pipeline-step-active"
                    : "pipeline-step-idle",
              ].join(" ")}
            >
              <div className="flex items-center justify-between">
                <span className="mono text-[8.5px] uppercase tracking-[0.13em]">
                  {entry}
                </span>

                <span className="mono text-[8px] opacity-60">
                  0{index + 1}
                </span>
              </div>

              <div className="mt-3 text-[10px] leading-[1.5] opacity-80">
                {done || finished
                  ? "Complete"
                  : active
                    ? stageCopy[entry]
                    : "Waiting"}
              </div>
            </div>
          );
        })}
      </div>

      {stage !== "done" && !error && (
        <p className="mt-4 flex items-center gap-2 text-[10.5px] text-slate-500">
          <LoaderCircle size={12} className="spin-slow text-cyan-300" />
          Planning runs a local model to completion, so it takes a minute or
          two. Execution then continues in the background and you will be
          taken to the live view.
        </p>
      )}

      {stage === "done" && workId && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link to={`/work/${workId}`} className="button-ghost">
            <Sparkles size={13} />
            See the plan, tool calls and result
          </Link>

          <Link to="/artifacts" className="button-quiet">
            <FileOutput size={12} />
            Artifacts
          </Link>

          <Link to="/brain" className="button-quiet">
            <Brain size={12} />
            Company Brain
          </Link>
        </div>
      )}
    </Panel>
  );
}

export function RefreshButton({
  onClick,
  spinning,
}: {
  onClick: () => void;
  spinning?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="button-quiet">
      <RefreshCw size={12} className={spinning ? "spin-slow" : undefined} />
      Refresh
    </button>
  );
}
