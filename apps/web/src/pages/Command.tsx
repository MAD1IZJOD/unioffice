import {
  ArrowRight,
  CircleDot,
  LoaderCircle,
  Zap,
} from "lucide-react";

import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  createWork,
  fetchMemory,
  fetchOverview,
  formatRelativeTime,
  type CompanyOverview,
  type MemoryItem,
  type WorkItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chapter,
  Connecting,
  Failure,
  Quiet,
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
import { collectAttention, summarizeAttention } from "../lib/attention";
import { profileOf } from "../lib/workforce";
import { SignalField } from "../components/SignalField";
import { AgentMark } from "../components/AgentMark";

/**
 * The composer records an objective and hands straight off to its mission.
 *
 * Planning and queueing used to run here, which meant staring at a spinner on
 * the wrong page while a local model took a minute to think. The mission
 * surface starts itself instead, so the wait happens where the operation will
 * keep happening and you watch the plan being written.
 */

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

  // The company's recent memory is context rather than live state, so it is
  // read on a much slower clock than the operational overview.
  const memory = useResource<MemoryItem[]>(
    useCallback(() => fetchMemory(undefined, 6), []),
    { pollMs: 60_000 },
  );

  const [objective, setObjective] = useState("");
  const [priority, setPriority] = useState<WorkItem["priority"]>("normal");
  const [busy, setBusy] = useState(false);
  const [launchError, setLaunchError] = useState<string>();

  async function launch() {
    const trimmed = objective.trim();
    if (!trimmed || busy) return;

    setLaunchError(undefined);
    setBusy(true);

    try {
      const work = await createWork({ objective: trimmed, priority });

      navigate(`/missions/${work.id}`, { state: { autostart: true } });
    } catch (error) {
      setLaunchError((error as Error).message);
      setBusy(false);
      overview.reload();
    }
  }

  const data = overview.data;
  const activeWork = data?.work.active ?? [];
  const finished = data?.work.recentlyCompleted ?? [];
  const agents = useMemo(() => data?.agents ?? [], [data]);
  const workingAgents = agents.filter((agent) => agent.presence === "working");
  const executing = activeWork.filter(
    (work) => work.status === "executing",
  ).length;
  const toolCalls =
    data?.tools.reduce((total, tool) => total + tool.callCount, 0) ?? 0;

  const attention = useMemo(() => collectAttention(data), [data]);

  // Who is on which objective, so a row in the stream can name the worker
  // rather than leaving the reader to cross-reference the roster.
  const workersByWork = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const agent of agents) {
      if (!agent.activeTask) continue;
      const current = map.get(agent.activeTask.workId) ?? [];
      current.push(agent.name);
      map.set(agent.activeTask.workId, current);
    }

    return map;
  }, [agents]);

  if (overview.error) {
    return (
      <div className="mx-auto max-w-[1340px] pt-6">
        <Failure
          headline={overview.error.isOffline ? "The company is unreachable" : "That read failed"}
          detail={overview.error.message}
          consequence={
            overview.error.isOffline
              ? "Nothing is lost - missions already queued keep running on the worker. The page just cannot see them."
              : "Nothing was changed by this request."
          }
          action={
            <button type="button" onClick={overview.reload} className="button-ghost">
              Try again
            </button>
          }
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
          agents={agents.length}
          executing={executing}
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
              value={overview.loading ? "—" : attention.length}
              tone="warning"
              live={attention.length > 0}
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
        {attention.length > 0 && (
          <Link to={attention[0]!.to} className="attention-bar">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-[#ffd9da]">
                {attention[0]!.label}
              </span>
              <span className="mt-1 block truncate text-[11px] text-[#c9868a]">
                {attention[0]!.detail}
              </span>
              <span className="mt-1.5 block text-[10px] text-[#9d6c70]">
                {attention[0]!.consequence}
                {attention.length > 1 && ` · ${summarizeAttention(attention)}`}
              </span>
            </span>

            <span className="shrink-0 text-[11px] font-semibold text-[#ff7176]">
              Review
            </span>
            <ArrowRight size={14} className="shrink-0 text-[#ff7176]" />
          </Link>
        )}

        {/* The one genuinely elevated surface on the page, because it is the
            only thing here you act with rather than read. */}
        <div className="composer">
          <div className="composer-head">
            <span className="t-eyebrow">Open a mission</span>
            <span className="t-machine">{busy ? "RUNNING" : "READY"}</span>
          </div>

          <textarea
            id="mission-objective"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            disabled={busy}
            rows={3}
            className="command-textarea w-full bg-transparent text-[15.5px] leading-[1.6] text-[#f2f4f7] placeholder:text-[#535b68] disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="What needs to happen?"
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

            <Link to="/missions/new" className="button-quiet">
              Add context
            </Link>

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
              {busy ? "Opening…" : "Open it"}
            </button>
          </div>
        </div>

        {launchError && (
          <div className="mt-3">
            <Failure
              headline="The mission was not opened"
              detail={launchError}
              consequence="Nothing was recorded and nothing is running."
            />
          </div>
        )}

        <Chapter
          index="01"
          title="On the floor"
          action={
            <Link to="/missions" className="button-quiet">
              Every mission
              <ArrowRight size={11} />
            </Link>
          }
        />

        <div className="command-grid">
          <div className="min-w-0">
            {overview.loading ? (
              <Connecting what="Fetching current operations…" />
            ) : activeWork.length === 0 ? (
              <Quiet
                line="Nothing is running."
                detail="Give the company an objective above and its plan, delegation and tool calls appear here as they happen."
              />
            ) : (
              <div className="ledger">
                {activeWork.map((work, index) => {
                  const workers = workersByWork.get(work.id) ?? [];

                  return (
                    <Link
                      key={work.id}
                      to={`/missions/${work.id}`}
                      className="ledger-row"
                    >
                      <span
                        className={`ledger-rail ${toneClass[workStatusTone(work.status)]}${work.status === "executing" ? " op-rail-running" : ""}`}
                      />

                      <span className="ledger-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <span className="min-w-0">
                        <span className="ledger-title">{work.objective}</span>

                        <span className="ledger-meta">
                          {workers.length > 0 && (
                            <span className="ledger-meta-agent">
                              {workers.join(" · ")}
                            </span>
                          )}
                          <span>{formatRelativeTime(work.createdAt)}</span>
                          <span className="uppercase">{work.priority}</span>
                        </span>
                      </span>

                      <span className="ledger-status">
                        <StatusPill
                          tone={workStatusTone(work.status)}
                          pulse={work.status === "executing"}
                        >
                          {statusLabel(work.status)}
                        </StatusPill>
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Who is doing it. */}
          <aside className="min-w-0">
            <div className="section-head">
              <div className="section-head-title">
                Workforce
                <span className="section-head-count">
                  {workingAgents.length > 0
                    ? `${workingAgents.length} working`
                    : `${agents.length} on the roster`}
                </span>
              </div>

              <Link to="/agents" className="button-quiet">
                Roster
              </Link>
            </div>

            {overview.loading ? (
              <Connecting what="Loading the workforce…" />
            ) : agents.length === 0 ? (
              <Quiet
                line="No one is on the roster."
                detail="Run the API with SEED_DEVELOPMENT_WORKFORCE=true to create the starting workforce."
              />
            ) : (
              <div className="space-y-px">
                {agents.map((agent) => (
                  <Link key={agent.agentId} to="/agents" className="presence-row">
                    <span
                      className={`presence-mark ${toneClass[presenceTone(agent.presence)]}`}
                    >
                      <AgentMark
                        agentId={agent.agentId}
                        capabilities={agent.capabilities}
                        tools={agent.toolIds.length}
                        type={agent.type}
                        size={22}
                        active={agent.presence === "working"}
                      />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[12px] font-semibold text-[#f2f4f7]">
                          {agent.name}
                        </span>
                        <span className="roster-role">
                          {profileOf(agent).label}
                        </span>
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
          </aside>
        </div>

        <Chapter
          index="02"
          title="What it just did"
          action={
            <Link to="/artifacts" className="button-quiet">
              Everything produced
            </Link>
          }
        />

        {overview.loading ? (
          <Connecting what="Reading recent outcomes…" />
        ) : finished.length === 0 ? (
          <Quiet
            line="The company has not finished anything yet."
            detail="Completed objectives land here with the result they produced and the memory they contributed."
          />
        ) : (
          <div className="ledger">
            {finished.map((work) => (
              <Link key={work.id} to={`/missions/${work.id}`} className="ledger-row">
                <span
                  className={`ledger-rail ${toneClass[workStatusTone(work.status)]}`}
                />

                <span className="ledger-index">
                  {work.status === "failed" ? "✕" : "✓"}
                </span>

                <span className="min-w-0">
                  <span className="ledger-title">{work.objective}</span>

                  <span className="ledger-meta">
                    <span>
                      {formatRelativeTime(work.completedAt ?? work.updatedAt)}
                    </span>
                    {typeof work.metadata.executionError === "string" && (
                      <span className="text-[#c9868a]">
                        {work.metadata.executionError}
                      </span>
                    )}
                  </span>
                </span>

                <span className="ledger-status">
                  <StatusPill tone={workStatusTone(work.status)}>
                    {statusLabel(work.status)}
                  </StatusPill>
                </span>
              </Link>
            ))}
          </div>
        )}

        <div className="grid gap-x-9 gap-y-0 lg:grid-cols-2">
          <div className="min-w-0">
            <Chapter
              index="03"
              title="The log"
              action={
                <Link to="/activity" className="button-quiet">
                  Full history
                </Link>
              }
            />

            {overview.loading ? (
              <Connecting what="Reading the log…" />
            ) : (data?.activity.length ?? 0) === 0 ? (
              <Quiet
                line="Nothing has been recorded."
                detail="Every plan, delegation, tool call and approval is written here as it happens."
              />
            ) : (
              <div className="scroll-area max-h-[380px] pr-1">
                {data!.activity.slice(0, 18).map((event) => {
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
          </div>

          <div className="min-w-0">
            <Chapter
              index="04"
              title="What it remembers"
              action={
                <Link to="/brain" className="button-quiet">
                  Company brain
                </Link>
              }
            />

            {memory.loading ? (
              <Connecting what="Recalling company memory…" />
            ) : memory.error ? (
              <p className="t-meta py-2">
                Memory could not be read: {memory.error.message}
              </p>
            ) : (memory.data?.length ?? 0) === 0 ? (
              <Quiet
                line="The company has not learned anything yet."
                detail="Every completed and failed task writes a memory, and agents read from it before starting related work."
              />
            ) : (
              <div className="space-y-px">
                {memory.data!.slice(0, 5).map((item) => (
                  <div key={item.id} className="stream-row">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] leading-[1.55] text-[#a7b0bd]">
                        {item.content.length > 130
                          ? `${item.content.slice(0, 130)}…`
                          : item.content}
                      </span>

                      <span className="mt-1 block text-[9px] uppercase tracking-[0.13em] text-[#535b68]">
                        {item.type} · {formatRelativeTime(item.createdAt)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
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
