import { ChevronDown, Wrench } from "lucide-react";

import {
  formatDuration,
  type ExecutionNode,
  type ExecutionRoom,
} from "../../lib/api";

import {
  agentNameOf,
  blockedExplanation,
  laneMeaning,
  nodeTitle,
  readinessLabel,
  readinessTone,
  taskOf,
  toolNameOf,
} from "../../lib/room";

import { safeStringify } from "../../lib/events";
import { toneClass } from "../../lib/tone";

import { AgentMark } from "../AgentMark";
import { ResultBody } from "../ResultBody";
import { Chip, StatusPill } from "../primitives";

/**
 * The floor.
 *
 * The plan drawn as the orchestrator laid it out: one lane per dependency
 * depth, every step in a lane genuinely able to run at the same time as its
 * neighbours. Two cards side by side is not a layout choice - it is the
 * backend saying those two steps do not wait on each other.
 *
 * Every edge here is a `dependsOn` the planner wrote and the API resolved.
 * Nothing is drawn to fill the picture out, which is why a single-step plan
 * renders as a single card rather than as a graph with one node in it.
 */
export function ExecutionFloor({
  room,
  focused,
  onFocus,
}: {
  room: ExecutionRoom;
  /** The step the room is currently looking at, if any. */
  focused?: string;
  onFocus: (taskId: string | undefined) => void;
}) {
  const { plan } = room;

  return (
    <div className="floor">
      {plan.hasCycle && (
        <div className="callout callout-warning mb-6">
          <div className="detail-label mb-1.5">The plan folds back on itself</div>
          Some of these steps depend on each other in a circle, so they cannot
          become ready on their own. The lanes below still show every step; the
          ones in the loop are laid out after everything that could be ordered.
        </div>
      )}

      {plan.lanes.map((lane, index) => (
        <section key={lane.depth} className="lane">
          <div className="lane-spine" aria-hidden="true">
            <span className="lane-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            {index < plan.lanes.length - 1 && <span className="lane-thread" />}
          </div>

          <div className="lane-body">
            <div className="lane-meaning">
              {laneMeaning(lane.taskIds.length, lane.depth)}
            </div>

            <div
              className={`lane-steps${
                lane.taskIds.length > 1 ? " lane-steps-parallel" : ""
              }`}
            >
              {lane.taskIds.map((taskId) => {
                const node = plan.nodes.find(
                  (candidate) => candidate.taskId === taskId,
                );

                if (!node) return null;

                return (
                  <Step
                    key={taskId}
                    room={room}
                    node={node}
                    open={focused === taskId}
                    onToggle={() =>
                      onFocus(focused === taskId ? undefined : taskId)
                    }
                  />
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function Step({
  room,
  node,
  open,
  onToggle,
}: {
  room: ExecutionRoom;
  node: ExecutionNode;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = readinessTone(node.readiness);
  const agent = agentNameOf(room, node.assignedAgentId);
  const blocked = blockedExplanation(room.plan, node);
  const task = taskOf(room, node.taskId);

  const agentRecord = room.agents.find(
    (candidate) => candidate.id === node.assignedAgentId,
  );

  return (
    <article
      className={`step ${toneClass[tone]}${open ? " step-open" : ""}${
        node.readiness === "running" ? " step-running" : ""
      }${node.awaitingApproval ? " step-holding" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="step-head"
      >
        <span className="step-mark">
          {agentRecord ? (
            <AgentMark
              agentId={agentRecord.id}
              capabilities={agentRecord.capabilities}
              tools={agentRecord.toolIds.length}
              type={agentRecord.type}
              size={26}
              active={node.readiness === "running"}
            />
          ) : (
            <span className="step-mark-empty" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="step-title">{node.title}</span>

          <span className="step-meta">
            <span className="step-agent">{agent ?? "Unassigned"}</span>

            {node.requiredTools.map((tool) => (
              <span key={tool} className="tool-tag">
                {toolNameOf(room, tool)}
              </span>
            ))}

            {node.toolCallCount > 0 && (
              <span>
                {node.toolCallCount} tool{" "}
                {node.toolCallCount === 1 ? "call" : "calls"}
              </span>
            )}

            {node.durationMs !== undefined && (
              <span>{formatDuration(node.startedAt, node.completedAt)}</span>
            )}
          </span>

          {/* The single most useful line on a stalled plan: who is holding
              whom, by name. It disappears the moment the dependency lands. */}
          {blocked && <span className="step-blocked">{blocked}</span>}
        </span>

        <span className="step-state">
          <StatusPill tone={tone} pulse={node.readiness === "running"}>
            {readinessLabel(node.readiness)}
          </StatusPill>

          <ChevronDown
            size={14}
            className={`step-chevron${open ? " step-chevron-open" : ""}`}
          />
        </span>
      </button>

      {open && (
        <div className="step-body">
          <p className="step-description">{node.description}</p>

          {node.requiredCapabilities.length > 0 && (
            <div className="step-requirements">
              <span className="detail-label">Routed on</span>

              {node.requiredCapabilities.map((capability) => (
                <Chip key={capability}>{capability.replace(/_/g, " ")}</Chip>
              ))}
            </div>
          )}

          {node.blocks.length > 0 && (
            <p className="step-downstream">
              Feeds{" "}
              {node.blocks
                .map((id) => nodeTitle(room.plan, id))
                .filter(Boolean)
                .join(", ")}
            </p>
          )}

          {task?.metadata.execution?.error && (
            <div className="callout callout-error mt-4">
              {task.metadata.execution.error.message}
            </div>
          )}

          <ToolCalls room={room} node={node} />

          {task?.result !== undefined && task.result !== "" ? (
            <div className="mt-4">
              <div className="detail-label">What it returned</div>
              <div className="result-block mt-2">
                <ResultBody value={task.result} />
              </div>
            </div>
          ) : (
            <p className="step-nothing">
              {node.readiness === "waiting"
                ? "Held here until you decide."
                : node.readiness === "blocked"
                  ? "Has not started: it is still waiting on an earlier step."
                  : "Nothing has come back from this step yet."}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/** Every tool this step actually called, with what went in and what came back. */
function ToolCalls({
  room,
  node,
}: {
  room: ExecutionRoom;
  node: ExecutionNode;
}) {
  const calls = taskOf(room, node.taskId)?.metadata.execution?.toolCalls ?? [];

  if (calls.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {calls.map((call, index) => (
        <div key={`${call.toolId}-${index}`} className="tool-call">
          <div className="flex flex-wrap items-center gap-2">
            <Wrench size={12} className="text-[#84b4fb]" />

            <span className="mono text-[10.5px] font-semibold text-[#f2f4f7]">
              {toolNameOf(room, call.toolId)}
            </span>

            <StatusPill tone={call.status === "completed" ? "live" : "error"}>
              {call.status}
            </StatusPill>
          </div>

          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <div className="detail-label">Given</div>
              <pre className="code-block mt-1">
                {safeStringify(call.input, 2)}
              </pre>
            </div>

            <div className="min-w-0">
              <div className="detail-label">
                {call.error ? "Error" : "Returned"}
              </div>
              <pre className="code-block mt-1">
                {safeStringify(call.error ?? call.output, 2)}
              </pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
