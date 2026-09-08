import {
  ArrowRight,
  Bot,
  CircleDot,
  LoaderCircle,
  ShieldAlert,
  Zap,
} from "lucide-react";

import type { ReactNode } from "react";
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
  Section,
  Skeleton,
  StatusPill,
} from "../components/primitives";

import {
  presenceTone,
  statusLabel,
  toneClass,
  workStatusTone,
} from "../lib/tone";

import { describeEvent } from "../lib/events";
import { describeCompany } from "../lib/statement";
import { SignalField } from "../components/SignalField";
import { AgentSigil } from "../components/AgentSigil";

/**
 * The launch pipeline mirrors the real API calls, one stage per call. Nothing
 * here is timed or simulated - a stage advances only when the request behind
 * it actually returns, which is why planning visibly takes as long as the
 * model takes. Once execution is queued the page hands off to the work detail
 * view, which watches the same rows the worker is writing.
 */
type LaunchStage = "idle" | "creating" | "planning" | "executing" | "done";

/**
 * The planner runs as the organization's orchestrator, so the line naming it
 * reads the roster rather than hard-coding a name the seed could change.
 */
function stageCopy(
  stage: Exclude<LaunchStage, "idle">,
  orchestrator: string | undefined,
): string {
  switch (stage) {
    case "creating":
      return "Recording the objective";
    case "planning":
      return orchestrator
        ? `${orchestrator} is building the work plan`
        : "Building the work plan";
    case "executing":
      return "Queueing the plan for a worker";
    default:
      return "Execution is under way";
  }
}

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
  const approvals = data?.approvals ?? [];
  const toolCalls =
    data?.tools.reduce((total, tool) => total + tool.callCount, 0) ?? 0;
  const orchestratorName = data?.agents.find(
    (agent) => agent.type === "orchestrator",
  )?.name;

  if (overview.error) {
    return (
      <div className="mx-auto max-w-[1340px]">
        <ErrorState
          message={overview.error.message}
          offline={overview.error.isOffline}
          onRetry={overview.reload}
        />
      </div>
    );
  }

  const statement = describeCompany(data);

  return (
    <div className="fade-up">
      {/* The opening. The largest thing on the page is the company's own
          account of its state, generated from the same overview every other
          surface reads - so the art direction and the hierarchy are the same
          decision rather than two competing ones. */}
      <header className={`dispatch dispatch-${statement.mood}`}>
        <SignalField
          mood={statement.mood}
          activity={data?.activity.length ?? 0}
          agents={data?.agents.length ?? 0}
        />

        <div className="dispatch-inner">
          <h2 className="statement">
            {statement.headline.map((line) => (
              <span key={line} className="statement-line">
                {line}
              </span>
            ))}
          </h2>

          <p className="statement-detail">{statement.detail}</p>

          <div className="dispatch-meta">
            <DispatchStat
              label="In flight"
              value={overview.loading ? "—" : activeWork.length}
              tone="active"
              live={activeWork.length > 0}
            />
            <DispatchStat
              label="Working"
              value={overview.loading ? "—" : workingAgents.length}
              tone="active"
              live={workingAgents.length > 0}
            />
            <DispatchStat
              label="Awaiting you"
              value={overview.loading ? "—" : approvals.length}
              tone="warning"
              live={approvals.length > 0}
            />
            <DispatchStat
              label="Tool calls"
              value={overview.loading ? "—" : toolCalls}
              tone="idle"
            />
            <DispatchStat
              label="All time"
              value={overview.loading ? "—" : (data?.work.total ?? 0)}
              tone="idle"
            />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1340px] pt-7">
      {approvals.length > 0 && (
        <Link to="/approvals" className="attention-bar">
          <ShieldAlert size={15} className="shrink-0 text-[#ff7176]" />

          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-[#ffd9da]">
              {approvals[0]!.action}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-[#c9868a]">
              {approvals[0]!.reason}
            </span>
          </span>

          <span className="shrink-0 text-[11px] font-semibold text-[#ff7176]">
            Review
          </span>
          <ArrowRight size={14} className="shrink-0 text-[#ff7176]" />
        </Link>
      )}

      <div className="command-grid">
        <div className="min-w-0">
          {/* The one genuinely elevated surface on the page, because it is
              the only thing here you act with rather than read. */}
          <div className="composer">
            <div className="composer-head">
              <span className="t-eyebrow">New objective</span>
              <span className="t-machine">{busy ? "RUNNING" : "READY"}</span>
            </div>

            <textarea
              id="work-objective"
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              disabled={busy}
              rows={3}
              className="command-textarea w-full bg-transparent text-[14.5px] leading-[1.65] text-[#f2f4f7] placeholder:text-[#535b68] disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="What should the company accomplish?"
            />

            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => setObjective(suggestion)}
                  className="suggestion-chip"
                  title={suggestion}
                >
                  {suggestion.slice(0, 42)}…
                </button>
              ))}
            </div>

            <div className="composer-foot">
              <label className="flex items-center gap-2">
                <span className="t-eyebrow">Priority</span>

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
                  <LoaderCircle size={13} className="spin-slow" />
                ) : (
                  <Zap size={13} />
                )}
                {busy ? "Working…" : "Launch"}
              </button>
            </div>
          </div>

          {stage !== "idle" && (
            <LaunchPipeline
              stage={stage}
              workId={launchedWorkId}
              orchestrator={orchestratorName}
            />
          )}

          {launchError && stage === "idle" && (
            <div className="callout callout-error mt-3">
              {launchError}
              {launchedWorkId && (
                <Link
                  to={`/work/${launchedWorkId}`}
                  className="ml-2 underline underline-offset-2"
                >
                  Inspect it
                </Link>
              )}
            </div>
          )}

          <div className="mt-7">
            <Section
              title="In flight"
              count={activeWork.length > 0 ? activeWork.length : undefined}
              action={
                <Link to="/work" className="button-quiet">
                  All work
                  <ArrowRight size={11} />
                </Link>
              }
            >
              {overview.loading ? (
                <Skeleton rows={3} />
              ) : activeWork.length === 0 ? (
                <p className="t-meta py-2">
                  Nothing is executing. Give the company an objective above and
                  its plan, tasks and tool calls appear here as they happen.
                </p>
              ) : (
                <div className="op-list">
                  {activeWork.map((work) => (
                    <Link
                      key={work.id}
                      to={`/work/${work.id}`}
                      className="op-row"
                    >
                      <span
                        className={`op-rail ${toneClass[workStatusTone(work.status)]}${work.status === "executing" ? " op-rail-running" : ""}`}
                      />

                      <span className="min-w-0 flex-1">
                        <span className="op-row-title">{work.objective}</span>

                        <span className="op-row-meta">
                          <span className="t-machine">
                            {formatRelativeTime(work.createdAt)}
                          </span>
                          <span className="t-machine uppercase">
                            {work.priority}
                          </span>
                        </span>
                      </span>

                      <StatusPill
                        tone={workStatusTone(work.status)}
                        pulse={work.status === "executing"}
                      >
                        {statusLabel(work.status)}
                      </StatusPill>
                    </Link>
                  ))}
                </div>
              )}
            </Section>

            <Section
              title="Recently finished"
              action={
                <Link to="/activity" className="button-quiet">
                  Activity
                </Link>
              }
            >
              {overview.loading ? (
                <Skeleton rows={2} />
              ) : (data?.work.recentlyCompleted.length ?? 0) === 0 ? (
                <p className="t-meta py-2">
                  Finished objectives land here with their results and the
                  memory they contributed.
                </p>
              ) : (
                <div className="op-list">
                  {data!.work.recentlyCompleted.map((work) => (
                    <Link
                      key={work.id}
                      to={`/work/${work.id}`}
                      className="op-row op-row-quiet"
                    >
                      <span
                        className={`op-rail ${toneClass[workStatusTone(work.status)]}${work.status === "executing" ? " op-rail-running" : ""}`}
                      />

                      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[#a7b0bd]">
                        {work.objective}
                      </span>

                      <span className="t-machine shrink-0">
                        {formatRelativeTime(work.completedAt ?? work.updatedAt)}
                      </span>

                      <StatusPill tone={workStatusTone(work.status)}>
                        {statusLabel(work.status)}
                      </StatusPill>
                    </Link>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </div>

        {/* Right rail: who is doing what, and what the company just did. */}
        <aside className="min-w-0 space-y-6">
          <Section
            title="Workforce"
            count={
              workingAgents.length > 0
                ? `${workingAgents.length} working`
                : undefined
            }
            action={
              <Link to="/agents" className="button-quiet">
                Manage
              </Link>
            }
          >
            {overview.loading ? (
              <Skeleton rows={4} />
            ) : (data?.agents.length ?? 0) === 0 ? (
              <EmptyState
                icon={Bot}
                title="No agents registered"
                description="Seed the development workforce to give this organization a roster."
              />
            ) : (
              <div className="space-y-px">
                {data!.agents.map((agent) => (
                  <Link
                    key={agent.agentId}
                    to="/agents"
                    className="presence-row"
                  >
                    <span
                      className={`presence-mark ${toneClass[presenceTone(agent.presence)]}`}
                    >
                      <AgentSigil
                        agentId={agent.agentId}
                        capabilities={agent.capabilities}
                        tools={agent.toolIds.length}
                        size={22}
                        active={agent.presence === "working"}
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[11.5px] font-semibold text-[#f2f4f7]">
                          {agent.name}
                        </span>
                        <span className="t-machine">{agent.type}</span>
                      </span>

                      <span className="mt-0.5 block truncate text-[10px] text-[#6f7887]">
                        {agent.activeTask
                          ? agent.activeTask.title
                          : `${agent.toolIds.length} tools · ${agent.completedTaskCount} done`}
                      </span>
                    </span>

                    <StatusPill
                      tone={presenceTone(agent.presence)}
                      pulse={agent.presence === "working"}
                    >
                      {agent.presence}
                    </StatusPill>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Live stream"
            action={
              <Link to="/activity" className="button-quiet">
                Full log
              </Link>
            }
          >
            {overview.loading ? (
              <Skeleton rows={5} />
            ) : (data?.activity.length ?? 0) === 0 ? (
              <p className="t-meta py-2">
                Every plan, delegation, tool call and approval is recorded here.
              </p>
            ) : (
              <div className="scroll-area max-h-[400px] pr-1">
                {data!.activity.slice(0, 16).map((event) => {
                  const described = describeEvent(event);

                  return (
                    <div key={event.id} className="stream-row">
                      <CircleDot
                        size={9}
                        className={`stream-dot ${described.tone}`}
                      />

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-[#a7b0bd]">
                          {described.title}
                        </span>

                        {described.detail && (
                          <span className="mt-0.5 block truncate text-[9.5px] text-[#535b68]">
                            {described.detail}
                          </span>
                        )}
                      </span>

                      <span className="t-machine shrink-0">
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
        </aside>
      </div>
      </div>
    </div>
  );
}

function DispatchStat({
  label,
  value,
  tone,
  live = false,
}: {
  label: string;
  value: ReactNode;
  tone: "active" | "warning" | "idle";
  live?: boolean;
}) {
  return (
    <div className={`dispatch-stat ${toneClass[tone]}`}>
      <div
        className={`dispatch-stat-value${live ? " dispatch-stat-value-live" : ""}`}
      >
        {value}
      </div>
      <div className="dispatch-stat-label">{label}</div>
    </div>
  );
}

function LaunchPipeline({
  stage,
  workId,
  orchestrator,
}: {
  stage: LaunchStage;
  workId?: string;
  orchestrator?: string;
}) {
  const order: Array<Exclude<LaunchStage, "idle">> = [
    "creating",
    "planning",
    "executing",
    "done",
  ];
  const currentIndex = order.indexOf(stage as Exclude<LaunchStage, "idle">);

  return (
    <div className="pipeline">
      <div className="pipeline-track">
        {order.map((entry, index) => {
          const done = index < currentIndex || stage === "done";
          const active = index === currentIndex && stage !== "done";

          return (
            <div
              key={entry}
              className={`pipeline-step${
                done
                  ? " pipeline-step-done"
                  : active
                    ? " pipeline-step-active"
                    : ""
              }`}
            >
              <span className="pipeline-dot" />
              <span className="pipeline-label">{entry}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[10.5px] text-[#6f7887]">
          {stage !== "done" && (
            <LoaderCircle size={11} className="spin-slow text-[#84b4fb]" />
          )}
          {stage === "done"
            ? "Handed to a worker. Opening the live view."
            : stageCopy(stage as Exclude<LaunchStage, "idle">, orchestrator)}
        </span>

        {workId && (
          <Link to={`/work/${workId}`} className="button-quiet">
            Open
            <ArrowRight size={11} />
          </Link>
        )}
      </div>
    </div>
  );
}
