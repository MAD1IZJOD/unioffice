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
  Chapter,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

import { AgentMark } from "../components/AgentMark";

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

  const totalCalls = (overview.data?.tools ?? []).reduce(
    (total, tool) => total + tool.callCount,
    0,
  );

  return (
    <div className="mx-auto max-w-[1080px] fade-up">
      <PageOpening
        eyebrow="System"
        title="THE MACHINERY"
        lead="AGENTS CAN REACH."
        detail="This is the whole of it. An agent can only affect the world through something on this page, and only if it is named below as authorized."
        meta={
          <>
            <Reading
              label="Registered"
              value={tools.loading ? "—" : (tools.data?.length ?? 0)}
              tone="active"
            />
            <Reading
              label="Recent calls"
              value={overview.loading ? "—" : totalCalls}
              tone="live"
              live={totalCalls > 0}
            />
          </>
        }
      />

      {tools.loading ? (
        <Connecting what="Reading the tool registry…" />
      ) : tools.error ? (
        <Failure
          headline={
            tools.error.isOffline
              ? "The company is unreachable"
              : "The registry could not be read"
          }
          detail={tools.error.message}
          action={
            <button type="button" onClick={tools.reload} className="button-ghost">
              Try again
            </button>
          }
        />
      ) : (tools.data?.length ?? 0) === 0 ? (
        <Quiet
          line="There is no machinery."
          detail="The tool registry is empty, so every agent can only reason from the context it is given. Nothing can be calculated, looked up or transformed."
        />
      ) : (
        <>
          <div className="border-t border-[#161a21]">
            {tools.data!.map((tool) => {
              const usage = usageById.get(tool.id);
              const authorized = agentsByTool(tool.id);

              return (
                <div key={tool.id} className="infra-row">
                  <div className="min-w-0">
                    <div className="infra-name">
                      {tool.name}
                      <span className="infra-id">{tool.id}</span>
                      <span className="infra-id">v{tool.version}</span>
                    </div>

                    <p className="infra-description">{tool.description}</p>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <StatusPill tone={usage?.callCount ? "live" : "idle"}>
                        {usage?.callCount ?? 0} recent{" "}
                        {usage?.callCount === 1 ? "call" : "calls"}
                      </StatusPill>

                      <span className="t-machine">
                        {authorized.length} authorized
                      </span>
                    </div>

                    <div className="infra-grants">
                      {authorized.length === 0 ? (
                        <span className="grant grant-none">
                          No agent holds this — the delegator will refuse any
                          task that requires it
                        </span>
                      ) : (
                        authorized.map((agent) => (
                          <span key={agent.agentId} className="grant tone-active">
                            <AgentMark
                              agentId={agent.agentId}
                              capabilities={agent.capabilities}
                              tools={agent.toolIds.length}
                              type={agent.type}
                              size={14}
                            />
                            {agent.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="detail-label">Input schema</div>
                    <pre className="code-block mt-2">
                      {safeStringify(tool.inputSchema, 2)}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>

          <Chapter index="—" title="How a tool call actually works" />

          <ol className="tool-protocol max-w-[74ch]">
            <li>The planner marks a task as requiring a specific tool by id.</li>
            <li>
              The delegator routes that task only to an agent explicitly
              authorized for it. This is a hard boundary, not a preference.
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
        </>
      )}
    </div>
  );
}
