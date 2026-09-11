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
            to={`/agents/${member.agent.id}`}
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

              {member.selectionReason && (
                <span className="cast-reason">
                  {member.stretched ? "Closest match: " : "Chosen because "}
                  {member.selectionReason}
                </span>
              )}
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
