import { Bot, Wrench } from "lucide-react";

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchOverview,
  type AgentPresenceSummary,
  type CompanyOverview,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import { AgentSigil } from "../components/AgentSigil";

import {
  Chip,
  PageOpening,
  Reading,
  EmptyState,
  ErrorState,
  Panel,
  Section,
  Skeleton,
  StatusPill,
} from "../components/primitives";

import {
  presenceTone,
  toneClass,
} from "../lib/tone";

const presenceCopy: Record<AgentPresenceSummary["presence"], string> = {
  working: "Executing a task right now.",
  waiting: "Holding for an approval decision.",
  blocked: "A recent task failed and needs attention.",
  available: "Ready to be delegated work.",
  disabled: "Not active in this organization.",
};

export default function Agents() {
  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(40), []),
    { pollMs: 15_000 },
  );

  const [selectedId, setSelectedId] = useState<string>();
  const agents = overview.data?.agents ?? [];
  const selected =
    agents.find((agent) => agent.agentId === selectedId) ?? agents[0];

  return (
    <div className="mx-auto max-w-[1240px] fade-up">
      <PageOpening
        eyebrow="Workforce"
        title="THE WORKFORCE"
        lead="AND WHAT IT HOLDS."
        detail="What each agent is responsible for, which tools it is authorized to call, and what it is doing now."
        tone={agents.some((a) => a.presence === "working") ? "moving" : "quiet"}
        meta={
          <>
            <Reading label="Working" value={agents.filter((a) => a.presence === "working").length} tone="active" live={agents.some((a) => a.presence === "working")} />
            <Reading label="Available" value={agents.filter((a) => a.presence === "available").length} tone="live" />
            <Reading label="Tools granted" value={agents.reduce((total, a) => total + a.toolIds.length, 0)} tone="idle" />
          </>
        }
      />

      {overview.loading ? (
        <Panel>
          <Skeleton rows={6} />
        </Panel>
      ) : overview.error ? (
        <Panel>
          <ErrorState
            message={overview.error.message}
            offline={overview.error.isOffline}
            onRetry={overview.reload}
          />
        </Panel>
      ) : agents.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Bot}
            title="No agents in this organization"
            description="Run the API with SEED_DEVELOPMENT_WORKFORCE=true to create the starting workforce."
          />
        </Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          {/* A roster, not a wall of profile cards: one row per worker, with
              the orchestrator separated from the specialists because they do
              genuinely different jobs. */}
          <div>
            {(["orchestrator", "manager", "specialist"] as const)
              .map((type) => ({
                type,
                members: agents.filter((agent) => agent.type === type),
              }))
              .filter((group) => group.members.length > 0)
              .map((group) => (
                <Section
                  key={group.type}
                  title={group.type === "orchestrator" ? "Coordination" : group.type === "manager" ? "Management" : "Specialists"}
                  count={group.members.length}
                >
                  <div className="op-list">
                    {group.members.map((agent) => (
                      <button
                        key={agent.agentId}
                        type="button"
                        onClick={() => setSelectedId(agent.agentId)}
                        className={`roster-row${selected?.agentId === agent.agentId ? " roster-row-selected" : ""}`}
                      >
                        <span
                          className={`roster-mark ${toneClass[presenceTone(agent.presence)]}`}
                        >
                          <AgentSigil
                            agentId={agent.agentId}
                            capabilities={agent.capabilities}
                            tools={agent.toolIds.length}
                            size={26}
                            active={agent.presence === "working"}
                          />
                        </span>

                        <span className="min-w-0 flex-1 text-left">
                          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                            <span className="text-[13px] font-semibold text-[#f2f4f7]">
                              {agent.name}
                            </span>

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
                                no tools
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
                </Section>
              ))}
          </div>

          {selected && (
            <Panel
              eyebrow="Agent"
              title={selected.name}
              className="self-start"
              action={
                <StatusPill tone={presenceTone(selected.presence)}>
                  {selected.presence}
                </StatusPill>
              }
            >
              <p className="text-[11.5px] leading-[1.7] text-slate-400">
                {selected.description}
              </p>

              <p className="mt-3 text-[10.5px] leading-[1.6] text-slate-500">
                {presenceCopy[selected.presence]}
              </p>

              <div className="mt-5">
                <div className="detail-label">Capabilities</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.capabilities.map((capability) => (
                    <Chip key={capability} tone="idle">
                      {capability}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="mt-5">
                <div className="detail-label">Authorized tools</div>

                {selected.toolIds.length === 0 ? (
                  <p className="mt-2 text-[10.5px] leading-[1.6] text-slate-500">
                    This agent holds no tools, so the delegator will never route
                    a task that requires one to it.
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
                <div className="mt-5">
                  <div className="detail-label">Current work</div>

                  <Link
                    to={`/work/${selected.activeTask.workId}`}
                    className="agent-active-task mt-2 !flex"
                  >
                    <span className="truncate text-[11px] text-slate-300">
                      {selected.activeTask.title}
                    </span>
                  </Link>
                </div>
              )}

              {typeof selected.metadata?.systemInstructions === "string" && (
                <div className="mt-5">
                  <div className="detail-label">System instructions</div>
                  <pre className="code-block mt-2">
                    {selected.metadata.systemInstructions}
                  </pre>
                </div>
              )}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
