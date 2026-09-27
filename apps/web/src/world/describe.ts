import { formatRelativeTime, type WorldAgent, type WorldHandoff, type WorldSnapshot } from "../lib/api";
import { PRESENCE } from "../lib/workforce";

import type { WorldMoment } from "./moments";

/**
 * How the world says what it shows.
 *
 * The map, the inspector, the list view and the announcements for screen
 * readers all read their words from here, so an agent drawn as waiting is
 * described as waiting everywhere, in the same sentence - and someone who
 * cannot or chooses not to see the motion is told exactly what the motion
 * would have shown.
 */

/** What an agent's desk shows. One per state the server records. */
export type DeskState =
  | "planning"
  | "working"
  | "elsewhere"
  | "waiting"
  | "available"
  | "paused"
  | "unavailable";

export function deskStateOf(agent: WorldAgent): DeskState {
  if (agent.status === "disabled") return "unavailable";
  if (agent.status === "paused") return "paused";
  if (agent.presence === "waiting") return "waiting";
  if (agent.presence === "working") return agent.workingElsewhere ? "elsewhere" : "working";
  if (agent.planning || agent.planningElsewhere) return "planning";
  if (agent.presence === "unavailable") return "unavailable";
  return "available";
}

export const DESK_LABEL: Record<DeskState, string> = {
  planning: "Writing a plan",
  working: PRESENCE.working.label,
  elsewhere: "Working",
  waiting: PRESENCE.waiting.label,
  available: PRESENCE.available.label,
  paused: PRESENCE.paused.label,
  unavailable: PRESENCE.unavailable.label,
};

/** One sentence: what this agent is doing right now. */
export function agentLine(agent: WorldAgent): string {
  switch (deskStateOf(agent)) {
    case "planning":
      return agent.planning
        ? `Writing the plan for “${agent.planning.missionName}”.`
        : "Writing a plan for a mission you cannot open.";
    case "working":
      return agent.current
        ? `Working on “${agent.current.taskTitle}” in “${agent.current.missionName}”.`
        : "Working.";
    case "elsewhere":
      return "Working on a mission you cannot open.";
    case "waiting":
      return agent.current
        ? `Held on “${agent.current.taskTitle}” until someone decides.`
        : agent.workingElsewhere
          ? "Held for a decision on a mission you cannot open."
          : "Held until someone decides.";
    case "paused":
      return "Paused. Given no new steps until someone resumes it.";
    case "unavailable":
      return "Unavailable. Not given any work.";
    case "available":
      return agent.upcomingSteps > 0
        ? `Available, with ${agent.upcomingSteps} ${agent.upcomingSteps === 1 ? "step" : "steps"} waiting to start.`
        : "Available.";
  }
}

/** What the agent last finished, if the caller may know it. */
export function lastLine(agent: WorldAgent): string | undefined {
  const last = agent.lastOutcome;
  if (!last) return undefined;

  return last.outcome === "completed"
    ? `Last finished “${last.taskTitle}” ${formatRelativeTime(last.at)}.`
    : `Could not finish “${last.taskTitle}” ${formatRelativeTime(last.at)}.`;
}

/** The label a screen reader hears for an agent on the map. */
export function agentLabel(agent: WorldAgent, roomName: string | undefined): string {
  return [agent.name, roomName, agentLine(agent)].filter(Boolean).join(". ");
}

export const HANDOFF_LABEL: Record<WorldHandoff["state"], string> = {
  in_progress: "In hand",
  waiting: "Held for a decision",
  delivered: "Delivered",
  stalled: "Not picked up yet",
};

/** A moment, as one sentence for the log and for announcements. */
export function momentLine(moment: WorldMoment, snapshot: WorldSnapshot): string {
  const name = (id: string | undefined) => snapshot.agents.find((agent) => agent.id === id)?.name ?? "An agent";

  switch (moment.kind) {
    case "handoff":
      return `${moment.handoff.from.name} handed step ${moment.handoff.fromStep.number} to ${moment.handoff.to.name} in “${moment.handoff.missionName}”.`;
    case "assigned": {
      const who = moment.toAgentIds.map((id) => name(id));
      const to = who.length === 0 ? "the workforce" : who.length === 1 ? who[0] : `${who.slice(0, -1).join(", ")} and ${who.at(-1)}`;
      return moment.fromAgentId
        ? `${name(moment.fromAgentId)}'s plan for “${moment.missionName}” gave steps to ${to}.`
        : `The plan for “${moment.missionName}” gave steps to ${to}.`;
    }
    case "planning":
      return `${name(moment.agentId)} started writing the plan for “${moment.missionName}”.`;
    case "started":
      return moment.taskTitle
        ? `${name(moment.agentId)} started “${moment.taskTitle}”.`
        : `${name(moment.agentId)} started work on a mission you cannot open.`;
    case "waiting":
      return moment.taskTitle
        ? `${name(moment.agentId)} is held on “${moment.taskTitle}” until someone decides.`
        : `${name(moment.agentId)} is held for a decision.`;
    case "finished":
      return moment.outcome === "completed"
        ? `${name(moment.agentId)} finished “${moment.taskTitle}”.`
        : `${name(moment.agentId)} could not finish “${moment.taskTitle}”.`;
  }
}

/** Where a moment happened, for following it with the camera. */
export function momentAgentId(moment: WorldMoment): string | undefined {
  switch (moment.kind) {
    case "handoff":
      return moment.handoff.to.id;
    case "assigned":
      return moment.fromAgentId ?? moment.toAgentIds[0];
    default:
      return moment.agentId;
  }
}
