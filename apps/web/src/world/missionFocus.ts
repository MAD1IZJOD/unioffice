import type { WorldMission, WorldSnapshot } from "../lib/api";

import type { FocusTarget } from "./camera";

/**
 * Opening the world on one mission: `/world?mission=<id>`.
 *
 * The id in the address is never trusted on its own. It is only looked up
 * in the snapshot the server already built for this viewer - narrowed to
 * their organization and the workspaces they reach - so a mission that does
 * not exist, belongs to another company, is not theirs to open or is no
 * longer under way are all the same thing here: not in view. Nothing is
 * requested to find out which, so nothing about it can leak.
 */

/** The mission a link names, when it is one this viewer's snapshot holds. */
export function missionInView(snapshot: WorldSnapshot, id: string | null | undefined): WorldMission | undefined {
  if (!id) return undefined;
  return snapshot.missions.find((mission) => mission.id === id);
}

/**
 * Everyone on a mission, as the snapshot records it: holding one of its
 * steps, or writing its plan. In seat order, so the same mission always
 * names the same people in the same order.
 */
export function agentsOn(snapshot: WorldSnapshot, mission: WorldMission): string[] {
  const on = new Set(mission.agentIds);

  for (const agent of snapshot.agents) {
    if (agent.planning?.missionId === mission.id) on.add(agent.id);
  }

  return snapshot.agents.filter((agent) => on.has(agent.id)).map((agent) => agent.id);
}

/** Where to look for a mission: its people, or its room while nobody holds a step. */
export function missionTarget(snapshot: WorldSnapshot, mission: WorldMission): FocusTarget | undefined {
  const ids = agentsOn(snapshot, mission);
  if (ids.length > 0) return { kind: "agents", ids };

  const room = mission.workspaceId ? snapshot.rooms.find((entry) => entry.id === mission.workspaceId) : undefined;
  return room ? { kind: "room", id: room.id } : undefined;
}
