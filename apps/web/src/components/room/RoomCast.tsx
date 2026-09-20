import { Link } from "react-router-dom";

import type { ExecutionRoom } from "../../lib/api";

import { nodeTitle } from "../../lib/room";
import { profileOf } from "../../lib/workforce";
import { toneClass, type Tone } from "../../lib/tone";

import { AgentMark } from "../AgentMark";
import { StatusPill } from "../primitives";

/**
 * Who is on this mission.
 *
 * An agent is here because the delegator gave it work, never because it
 * exists on the roster - the roster is a different question and has its own
 * surface. What each one is doing comes from its task rows, so an idle agent
 * reads as idle rather than being animated into looking busy.
 */
/**
 * Why this agent, in a sentence a person can read.
 *
 * The delegator's own reason is a ranking record - scores, workspace
 * compatibility, availability - which answers an engineer's question, not
 * "why them?". The same facts say it plainly: what the step asked for, and
 * what this agent can do. The original sentence is kept underneath for
 * anyone who wants it.
 */
function whyThisAgent(
  room: ExecutionRoom,
  member: ExecutionRoom["cast"][number],
): { plain: string; detail?: string } {
  const name = member.agent.name;
  const steps = room.plan.nodes.filter((node) => node.assignedAgentId === member.agent.id);

  const asked = (field: "requiredCapabilities" | "requiredTools") =>
    [...new Set(steps.flatMap((step) => step[field]))];

  const held = new Set(member.agent.capabilities);
  const matched = asked("requiredCapabilities").filter((capability) => held.has(capability));
  const missing = asked("requiredCapabilities").filter((capability) => !held.has(capability));

  const toolNames = asked("requiredTools")
    .filter((toolId) => member.agent.toolIds.includes(toolId))
    .map((toolId) => room.tools.find((tool) => tool.id === toolId)?.name ?? toolId);

  const readable = (capability: string) => capability.replace(/_/g, " ");
  const list = (items: string[]) =>
    items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

  const can = matched.length > 0 ? `can ${list(matched.map(readable))}` : undefined;
  const cleared = toolNames.length > 0 ? `is cleared to use ${list(toolNames)}` : undefined;
  const both = [can, cleared].filter(Boolean).join(", and ");

  const plain = member.stretched
    ? missing.length > 0
      ? `${name} is the closest available match: ${can ?? "able to take this on"}, but not ${list(missing.map(readable))}.`
      : `${name} is the closest available match for this work.`
    : both
      ? `${name} ${both}.`
      : `${name} was free to take this on.`;

  return { plain, detail: member.selectionReason };
}

export function RoomCast({ room }: { room: ExecutionRoom }) {
  if (room.cast.length === 0) return null;

  return (
    <div className="cast">
      {room.cast.map((member) => {
        const current = nodeTitle(room.plan, member.currentTaskId);
        const waitingOn = nodeTitle(room.plan, member.waitingOnTaskId);

        const tone: Tone = member.running
          ? "active"
          : member.failed
            ? "error"
            : waitingOn
              ? "warning"
              : member.completed
                ? "live"
                : "idle";

        const state = member.running
          ? "working"
          : waitingOn
            ? "waiting"
            : member.failed
              ? "blocked"
              : member.completed
                ? "done"
                : "idle";

        return (
          <Link
            key={member.agent.id}
            to={`/workforce/${member.agent.id}`}
            className={`cast-member ${toneClass[tone]}`}
          >
            <span className="cast-mark">
              <AgentMark
                agentId={member.agent.id}
                capabilities={member.agent.capabilities}
                tools={member.agent.toolIds.length}
                type={member.agent.type}
                size={34}
                active={member.running > 0}
              />
            </span>

            <span className="min-w-0 flex-1">
              <span className="cast-name-row">
                <span className="cast-name">{member.agent.name}</span>
                <span className="cast-role">{profileOf(member.agent).label}</span>
              </span>

              {/* One line saying what this person is actually doing. Only
                  ever a thing the backend confirmed. */}
              <span className="cast-doing">
                {current
                  ? current
                  : waitingOn
                    ? `Waiting for ${waitingOn}`
                    : member.completed === member.taskIds.length
                      ? `Finished ${member.completed} of ${member.taskIds.length}`
                      : `Holds ${member.taskIds.length} ${
                          member.taskIds.length === 1 ? "step" : "steps"
                        }`}
              </span>

              <span className="cast-facts">
                <span>
                  {member.completed}/{member.taskIds.length} done
                </span>
                {member.toolCalls > 0 && (
                  <span>
                    {member.toolCalls} tool{" "}
                    {member.toolCalls === 1 ? "call" : "calls"}
                  </span>
                )}
                {member.artifactCount > 0 && (
                  <span>
                    {member.artifactCount}{" "}
                    {member.artifactCount === 1 ? "artifact" : "artifacts"}
                  </span>
                )}
              </span>

              {member.selectionReason && (() => {
                const why = whyThisAgent(room, member);

                return (
                  <span className="cast-reason">
                    {why.plain}
                    {why.detail && (
                      <details className="cast-reason-detail">
                        <summary>How it was decided</summary>
                        {why.detail}
                      </details>
                    )}
                  </span>
                );
              })()}
            </span>

            <StatusPill tone={tone} pulse={member.running > 0}>
              {state}
            </StatusPill>
          </Link>
        );
      })}
    </div>
  );
}
