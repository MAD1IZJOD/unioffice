import { Link } from "react-router-dom";

import type { MissionMember } from "../lib/mission";

import { AgentMark } from "./AgentMark";
import { StatusPill } from "./primitives";

import { profileOf } from "../lib/workforce";
import { presenceTone, statusLabel, taskStatusTone, toneClass } from "../lib/tone";

/**
 * Who is on this mission.
 *
 * An agent appears here because the delegator actually gave it a task, not
 * because it is on the roster - so a mission with one task shows one person,
 * which is the truth. Each card says what they are holding, why they were
 * picked, and what they have produced, and leads to that agent's own page so
 * the mission and the workforce are two ways into the same fact.
 */
export function MissionCast({ members }: { members: MissionMember[] }) {
  return (
    <div className="mission-cast">
      {members.map((member) => {
        const tone = member.running
          ? presenceTone("working")
          : member.failed
            ? "error"
            : member.waiting
              ? "warning"
              : member.completed
                ? "live"
                : "idle";

        return (
          <Link
            key={member.agent.id}
            to={`/agents/${member.agent.id}`}
            className={`mission-member ${toneClass[tone]}`}
          >
            <div className="mission-member-head">
              <span className="mission-member-mark">
                <AgentMark
                  agentId={member.agent.id}
                  capabilities={member.agent.capabilities}
                  tools={member.agent.toolIds.length}
                  type={member.agent.type}
                  size={20}
                  active={member.running > 0}
                />
              </span>

              <span className="min-w-0 flex-1">
                <span className="mission-member-name block">
                  {member.agent.name}
                </span>
                <span className="mission-member-role block">
                  {profileOf(member.agent).label}
                </span>
              </span>

              {member.current ? (
                <StatusPill tone="active" pulse>
                  working
                </StatusPill>
              ) : (
                <StatusPill tone={tone}>
                  {member.failed
                    ? "failed"
                    : member.waiting
                      ? "waiting"
                      : member.completed === member.tasks.length
                        ? "done"
                        : "assigned"}
                </StatusPill>
              )}
            </div>

            <p className="mission-member-doing">
              {member.current
                ? member.current.title
                : member.tasks.length === 1
                  ? member.tasks[0]!.title
                  : `${member.tasks.length} tasks on this mission`}
            </p>

            {member.reason && (
              <p className="mission-member-why">{member.reason}</p>
            )}

            {member.stretched && (
              <p className="mission-member-stretch">
                Closest available match rather than an exact one.
              </p>
            )}

            <div className="mission-member-stats">
              <span>
                {member.completed}/{member.tasks.length} done
              </span>

              {member.toolCalls > 0 && (
                <span>
                  {member.toolCalls} tool{" "}
                  {member.toolCalls === 1 ? "call" : "calls"}
                </span>
              )}

              {member.tasks.length > 1 && (
                <span>
                  {statusLabel(
                    member.current?.status ??
                      member.tasks[member.tasks.length - 1]!.status,
                  )}
                </span>
              )}

              {member.failed > 0 && (
                <span className={toneClass[taskStatusTone("failed")]}>
                  {member.failed} failed
                </span>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
