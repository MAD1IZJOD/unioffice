import { Wrench } from "lucide-react";

import { useCallback } from "react";

import {
  fetchOverview,
  fetchTools,
  type CompanyOverview,
  type ToolDescriptor,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import { safeStringify } from "../lib/events";

import {
  Chip,
  PageOpening,
  Reading,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
} from "../components/primitives";

export default function Tools() {
  const tools = useResource<ToolDescriptor[]>(
    useCallback(() => fetchTools(), []),
  );

  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(150), []),
    { pollMs: 20_000 },
  );

  const usageById = new Map(
    (overview.data?.tools ?? []).map((tool) => [tool.id, tool]),
  );

  const agentsByTool = (toolId: string) =>
    (overview.data?.agents ?? []).filter((agent) =>
      agent.toolIds.includes(toolId),
    );

  return (
    <div className="mx-auto max-w-[1080px] fade-up">
      <PageOpening
        eyebrow="System"
        title="THE MACHINERY"
        lead="AGENTS CAN REACH."
        detail="A tool call is validated against its schema, checked against the calling agent's authorization, and recorded as an event."
        meta={
          <>
            <Reading label="Registered" value={tools.loading ? "—" : (tools.data?.length ?? 0)} tone="active" />
            <Reading label="Recent calls" value={(overview.data?.tools ?? []).reduce((total, tool) => total + tool.callCount, 0)} tone="live" />
          </>
        }
      />

      {tools.loading ? (
        <Panel>
          <Skeleton rows={5} />
        </Panel>
      ) : tools.error ? (
        <Panel>
          <ErrorState
            message={tools.error.message}
            offline={tools.error.isOffline}
            onRetry={tools.reload}
          />
        </Panel>
      ) : (tools.data?.length ?? 0) === 0 ? (
        <Panel>
          <EmptyState
            icon={Wrench}
            title="No tools registered"
            description="The tool registry is empty, so agents can only reason from context."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {tools.data!.map((tool) => {
            const usage = usageById.get(tool.id);
            const authorized = agentsByTool(tool.id);

            return (
              <Panel
                key={tool.id}
                eyebrow={`v${tool.version}`}
                title={tool.name}
                action={
                  <div className="flex items-center gap-2">
                    <Chip tone={usage?.callCount ? "live" : "idle"}>
                      {usage?.callCount ?? 0} recent calls
                    </Chip>

                    <Chip tone="active">{tool.id}</Chip>
                  </div>
                }
              >
                <p className="text-[11.5px] leading-[1.7] text-slate-400">
                  {tool.description}
                </p>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="detail-label">Authorized agents</div>

                    {authorized.length === 0 ? (
                      <p className="mt-2 text-[10.5px] leading-[1.6] text-slate-500">
                        No agent holds this tool, so the delegator will refuse
                        any task that requires it.
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {authorized.map((agent) => (
                          <Chip key={agent.agentId} tone="live">
                            {agent.name}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="detail-label">Input schema</div>
                    <pre className="code-block mt-2">
                      {safeStringify(tool.inputSchema, 2)}
                    </pre>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel className="mt-4" eyebrow="Contract" title="How a tool call works">
        <ol className="tool-protocol">
          <li>The planner marks a task as requiring a specific tool by id.</li>
          <li>
            The delegator routes that task only to an agent explicitly
            authorized for it — this is a hard boundary, not a preference.
          </li>
          <li>
            The agent requests the tool in a strict JSON envelope; anything
            malformed is treated as a plain answer rather than a silent call.
          </li>
          <li>
            The executor validates the input against the tool's schema and
            re-checks authorization before running it.
          </li>
          <li>
            The real result is fed back into the agent's context, and a
            tool.completed or tool.failed event is recorded.
          </li>
          <li>
            An answer that skips a required tool is rejected and the agent is
            asked again, so a confident guess cannot pass as a tool result.
          </li>
        </ol>
      </Panel>
    </div>
  );
}
