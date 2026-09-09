import { Wrench } from "lucide-react";

import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  fetchOverview,
  formatRelativeTime,
  type AgentPresenceSummary,
  type CompanyOverview,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import { AgentMark } from "../components/AgentMark";

import {
  Chip,
  Connecting,
  Failure,
  PageOpening,
  Panel,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

import { presenceTone, toneClass } from "../lib/tone";
import { spellOut } from "../lib/statement";
import { groupByDiscipline, profileOf } from "../lib/workforce";

const presenceCopy: Record<AgentPresenceSummary["presence"], string> = {
  working: "Executing a task right now.",
  waiting: "Holding for an approval decision.",
  blocked: "A recent task failed and has not been retried.",
  available: "Ready to be delegated work.",
  disabled: "Not active in this organization.",
};

export default function Agents() {
  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(60), []),
    { pollMs: 15_000 },
  );

  // A mission links here with the agent it wants opened, so arriving from
  // "who worked on this" lands on that agent rather than on whoever happens
  // to be first on the roster. The URL is the selection, which also makes the
  // choice shareable and survivable across a reload.
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("agent") ?? undefined;

  const setSelectedId = (agentId: string) => {
    setParams({ agent: agentId }, { replace: true });
  };

  const agents = useMemo(() => overview.data?.agents ?? [], [overview.data]);
  const selected =
    agents.find((agent) => agent.agentId === selectedId) ?? agents[0];

  const working = agents.filter((agent) => agent.presence === "working");
  const groups = useMemo(() => groupByDiscipline(agents), [agents]);

  // Which objectives a worker has actually touched, read off the event log
  // rather than guessed. Cross-navigation only earns its place when it points
  // at something real.
  const recentWorkFor = useMemo(() => {
    const data = overview.data;
    if (!data || !selected) return [];

    const objectives = new Map(
      [...data.work.active, ...data.work.recentlyCompleted].map((work) => [
        work.id,
        work,
      ]),
    );

    const seen = new Set<string>();
    const result: Array<{ id: string; objective: string; when: string }> = [];

    for (const event of data.activity) {
      if (event.agentId !== selected.agentId || !event.workId) continue;
      if (seen.has(event.workId)) continue;

      seen.add(event.workId);
      const work = objectives.get(event.workId);

      result.push({
        id: event.workId,
        objective: work?.objective ?? "An earlier objective",
        when: event.timestamp,
      });

      if (result.length === 5) break;
    }

    return result;
  }, [overview.data, selected]);

  return (
    <div className="mx-auto max-w-[1240px] fade-up">
      <PageOpening
        eyebrow="Workforce"
        title={
          overview.loading ? "THE WORKFORCE." : `${spellOut(agents.length)} WORKERS.`
        }
        lead={
          working.length > 0
            ? `${spellOut(working.length)} AT WORK.`
            : "ALL STANDING BY."
        }
        detail="Each holds a different set of capabilities and a different set of tools, and the delegator routes on exactly those two facts."
        tone={working.length > 0 ? "moving" : "quiet"}
        meta={
          <>
            <Reading
              label="On the roster"
              value={overview.loading ? "—" : agents.length}
              tone="idle"
            />
            <Reading
              label="Working"
              value={overview.loading ? "—" : working.length}
              tone="active"
              live={working.length > 0}
            />
            <Reading
              label="Available"
              value={
                overview.loading
                  ? "—"
                  : agents.filter((agent) => agent.presence === "available")
                      .length
              }
              tone="live"
            />
            <Reading
              label="Tool grants"
              value={
                overview.loading
                  ? "—"
                  : agents.reduce(
                      (total, agent) => total + agent.toolIds.length,
                      0,
                    )
              }
              tone="idle"
            />
          </>
        }
      />

      {overview.loading ? (
        <Connecting what="Loading the workforce…" />
      ) : overview.error ? (
        <Failure
          headline={
            overview.error.isOffline
              ? "The company is unreachable"
              : "The roster could not be read"
          }
          detail={overview.error.message}
          action={
            <button
              type="button"
              onClick={overview.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      ) : agents.length === 0 ? (
        <Quiet
          line="No one has been hired."
          detail="Run the API with SEED_DEVELOPMENT_WORKFORCE=true and the starting workforce is created on boot."
        />
      ) : (
        <div className="grid gap-8 xl:grid-cols-[1fr_340px]">
          <div className="min-w-0">
            {groups.map((group) => (
              <section key={group.discipline}>
                <div className="discipline-head">
                  <span className="discipline-name">{group.profile.label}</span>
                  <span className="discipline-role">{group.profile.role}</span>
                  <span className="discipline-rule" />
                  <span className="t-machine">{group.members.length}</span>
                </div>

                <div className="op-list">
                  {group.members.map((agent) => (
                    <button
                      key={agent.agentId}
                      type="button"
                      onClick={() => setSelectedId(agent.agentId)}
                      className={`roster-row${selected?.agentId === agent.agentId ? " roster-row-selected" : ""}`}
                      aria-pressed={selected?.agentId === agent.agentId}
                    >
                      <span
                        className={`roster-mark ${toneClass[presenceTone(agent.presence)]}`}
                      >
                        <AgentMark
                          agentId={agent.agentId}
                          capabilities={agent.capabilities}
                          tools={agent.toolIds.length}
                          type={agent.type}
                          size={26}
                          active={agent.presence === "working"}
                        />
                      </span>

                      <span className="min-w-0 flex-1 text-left">
                        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                          <span className="roster-name">{agent.name}</span>
                          <span className="t-machine">
                            {agent.capabilities.join(" · ")}
                          </span>
                        </span>

                        <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {agent.activeTask ? (
                            <span className="truncate text-[10.5px] text-[#84b4fb]">
                              {agent.activeTask.title}
                            </span>
                          ) : (
                            <span className="t-machine">
                              {agent.completedTaskCount} done
                              {agent.failedTaskCount > 0
                                ? ` · ${agent.failedTaskCount} failed`
                                : ""}
                            </span>
                          )}

                          {agent.toolIds.length === 0 ? (
                            <span className="t-machine opacity-70">
                              holds no tools
                            </span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {agent.toolIds.map((tool) => (
                                <span key={tool} className="tool-tag">
                                  {tool}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </span>

                      <StatusPill
                        tone={presenceTone(agent.presence)}
                        pulse={agent.presence === "working"}
                      >
                        {agent.presence}
                      </StatusPill>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {selected && (
            <Panel className="self-start" padded={false}>
              <div
                className={`agent-portrait ${toneClass[presenceTone(selected.presence)]}`}
              >
                <span className="agent-portrait-mark">
                  <AgentMark
                    agentId={selected.agentId}
                    capabilities={selected.capabilities}
                    tools={selected.toolIds.length}
                    type={selected.type}
                    size={40}
                    active={selected.presence === "working"}
                  />
                </span>

                <div className="min-w-0">
                  <div className="agent-portrait-name">{selected.name}</div>
                  <div className="roster-role mt-2">
                    {profileOf(selected).label}
                  </div>
                </div>
              </div>

              <div className="panel-body">
                <p className="text-[11.5px] leading-[1.75] text-[#a7b0bd]">
                  {selected.description}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <StatusPill
                    tone={presenceTone(selected.presence)}
                    pulse={selected.presence === "working"}
                  >
                    {selected.presence}
                  </StatusPill>

                  <span className="text-[10.5px] leading-[1.6] text-[#6f7887]">
                    {presenceCopy[selected.presence]}
                  </span>
                </div>

                <div className="mt-6">
                  <div className="detail-label">Capabilities</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.capabilities.map((capability) => (
                      <Chip key={capability} tone="idle">
                        {capability}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div className="mt-6">
                  <div className="detail-label">Authorized tools</div>

                  {selected.toolIds.length === 0 ? (
                    <p className="mt-2 text-[10.5px] leading-[1.65] text-[#6f7887]">
                      Holds no tools, so the delegator will never route a task
                      that requires one here. This is a hard boundary, not a
                      preference.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selected.toolIds.map((tool) => (
                        <Chip key={tool} tone="active">
                          <Wrench size={9} />
                          {tool}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>

                {selected.activeTask && (
                  <div className="mt-6">
                    <div className="detail-label">Doing now</div>

                    <Link
                      to={`/missions/${selected.activeTask.workId}`}
                      className="agent-active-task mt-2 !flex"
                    >
                      <span className="truncate text-[11px] text-[#a7b0bd]">
                        {selected.activeTask.title}
                      </span>
                    </Link>
                  </div>
                )}

                {recentWorkFor.length > 0 && (
                  <div className="mt-6">
                    <div className="detail-label">Recently involved in</div>

                    <div className="mt-2 space-y-px">
                      {recentWorkFor.map((entry) => (
                        <Link
                          key={entry.id}
                          to={`/missions/${entry.id}`}
                          className="presence-row"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] text-[#a7b0bd]">
                              {entry.objective}
                            </span>
                            <span className="t-machine">
                              {formatRelativeTime(entry.when)}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex gap-6">
                  <div>
                    <div className="detail-label">Completed</div>
                    <div className="mt-1.5 font-mono text-[16px] text-[#f2f4f7]">
                      {selected.completedTaskCount}
                    </div>
                  </div>

                  <div>
                    <div className="detail-label">Failed</div>
                    <div className="mt-1.5 font-mono text-[16px] text-[#f2f4f7]">
                      {selected.failedTaskCount}
                    </div>
                  </div>
                </div>

                {typeof selected.metadata?.systemInstructions === "string" && (
                  <div className="mt-6">
                    <div className="detail-label">System instructions</div>
                    <pre className="code-block mt-2">
                      {selected.metadata.systemInstructions}
                    </pre>
                  </div>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
