import { Bot, Wrench } from "lucide-react";

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchOverview,
  formatRelativeTime,
  type AgentPresenceSummary,
  type CompanyOverview,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chip,
  EmptyState,
  ErrorState,
  Panel,
  SectionHeading,
  Skeleton,
  StatusPill,
} from "../components/primitives";

import {
  presenceTone,
  statusLabel,
  taskStatusTone,
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
      <SectionHeading
        title="Agents"
        description="The company's workforce: what each agent is responsible for, which tools it is authorized to call, and what it is doing now."
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
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <button
                key={agent.agentId}
                type="button"
                onClick={() => setSelectedId(agent.agentId)}
                className={`agent-card${selected?.agentId === agent.agentId ? " agent-card-selected" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`agent-mark ${presenceTone(agent.presence)}`}>
                    {agent.name.slice(0, 1)}
                  </span>

                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-slate-100">
                        {agent.name}
                      </span>

                      <span className="mono text-[8.5px] uppercase tracking-[0.11em] text-slate-600">
                        {agent.type}
                      </span>
                    </div>

                    <p className="mt-1.5 line-clamp-2 text-[10.5px] leading-[1.6] text-slate-500">
                      {agent.description}
                    </p>
                  </div>

                  <StatusPill
                    tone={presenceTone(agent.presence)}
                    pulse={agent.presence === "working"}
                  >
                    {agent.presence}
                  </StatusPill>
                </div>

                {agent.activeTask && (
                  <div className="agent-active-task">
                    <StatusPill tone={taskStatusTone(agent.activeTask.status)}>
                      {statusLabel(agent.activeTask.status)}
                    </StatusPill>

                    <span className="truncate text-[10.5px] text-slate-400">
                      {agent.activeTask.title}
                    </span>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.toolIds.length === 0 ? (
                    <Chip tone="idle">no tools</Chip>
                  ) : (
                    agent.toolIds.map((tool) => (
                      <Chip key={tool} tone="active">
                        <Wrench size={9} />
                        {tool}
                      </Chip>
                    ))
                  )}
                </div>

                <div className="mt-3 flex items-center gap-4 border-t border-[#1b252e] pt-3 mono text-[9px] text-slate-600">
                  <span>{agent.completedTaskCount} completed</span>
                  <span>{agent.failedTaskCount} failed</span>
                  <span className="ml-auto">
                    {agent.lastActiveAt
                      ? formatRelativeTime(agent.lastActiveAt)
                      : "never active"}
                  </span>
                </div>
              </button>
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
