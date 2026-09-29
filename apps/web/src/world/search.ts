import type { WorldSnapshot } from "../lib/api";

import { agentLine } from "./describe";
import { handoffKey } from "./moments";
import type { WorldSelection } from "./Scene";

/**
 * Finding something in the office by name.
 *
 * Searches only the snapshot the page already holds - the one the server
 * built for this viewer - so it can never turn up an agent, a mission or a
 * result the viewer could not already see on the map. No index, no request.
 *
 * What it looks through:
 *
 *   agents     by name, and by the step and mission they are on right now
 *   rooms      by name
 *   missions   the live ones on the board, by name
 *   handoffs   by the result that changed hands and the steps either side
 */

export interface SearchHit {
  /** What kind of thing it is, so a list of hits can say. */
  kind: "agent" | "room" | "mission" | "result" | "handoff";
  select: WorldSelection;
  /** The thing found, as the map names it. */
  label: string;
  /** Why it matched, or what it is, in a few words. */
  detail: string;
  /** The agent to bring into view, when there is one. */
  agentId?: string;
  /** The room to bring into view, when there is one. */
  roomId?: string;
}

const KIND_ORDER: Record<WorldSelection["kind"], number> = { agent: 0, room: 1, mission: 2, handoff: 3 };

export function searchWorld(snapshot: WorldSnapshot, query: string, limit = 8): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) return [];

  const found: Array<{ rank: number; hit: SearchHit }> = [];
  const add = (rank: number, hit: SearchHit) => found.push({ rank, hit });
  const rankOf = (text: string) => {
    const value = text.toLocaleLowerCase();
    if (value === needle) return 0;
    if (value.startsWith(needle)) return 1;
    if (value.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
    return value.includes(needle) ? 3 : undefined;
  };

  const roomName = (id: string) => snapshot.rooms.find((room) => room.id === id)?.name;

  const best = (ranks: Array<number | undefined>) => {
    const matched = ranks.filter((rank): rank is number => rank !== undefined);
    return matched.length > 0 ? Math.min(...matched) : undefined;
  };

  for (const agent of snapshot.agents) {
    const byName = rankOf(agent.name);
    // The work is only in the snapshot when the viewer may see it.
    const byWork = agent.current ? best([rankOf(agent.current.taskTitle), rankOf(agent.current.missionName)]) : undefined;
    const rank = byName ?? (byWork !== undefined ? byWork + 4 : undefined);
    if (rank === undefined) continue;

    add(rank, {
      kind: "agent",
      select: { kind: "agent", id: agent.id },
      label: agent.name,
      detail: byName !== undefined ? (roomName(agent.roomId) ?? "Agent") : agentLine(agent),
      agentId: agent.id,
    });
  }

  for (const room of snapshot.rooms) {
    const rank = rankOf(room.name);
    if (rank === undefined) continue;

    const count = room.agentIds.length;
    add(rank, {
      kind: "room",
      select: { kind: "room", id: room.id },
      label: room.name,
      detail: count === 0 ? "Nobody works here" : `${count} ${count === 1 ? "agent" : "agents"}`,
      roomId: room.id,
    });
  }

  for (const mission of snapshot.missions) {
    const rank = rankOf(mission.name);
    if (rank === undefined) continue;

    add(rank, {
      kind: "mission",
      select: { kind: "mission", id: mission.id },
      label: mission.name,
      detail: `Mission · ${mission.completedSteps} of ${mission.steps} steps done`,
      roomId: mission.workspaceId,
    });
  }

  for (const handoff of snapshot.handoffs) {
    const byResult = handoff.delivered ? rankOf(handoff.delivered.name) : undefined;
    const byStep = best([rankOf(handoff.fromStep.title), rankOf(handoff.toStep.title)]);
    const rank = byResult ?? (byStep !== undefined ? byStep + 4 : undefined);
    if (rank === undefined) continue;

    add(rank, {
      kind: handoff.delivered ? "result" : "handoff",
      select: { kind: "handoff", key: handoffKey(handoff) },
      label: handoff.delivered?.name ?? `${handoff.from.name} → ${handoff.to.name}`,
      detail: `${handoff.from.name} → ${handoff.to.name} · ${handoff.missionName}`,
      agentId: handoff.to.id,
    });
  }

  return found
    .sort((left, right) =>
      left.rank - right.rank ||
      KIND_ORDER[left.hit.select.kind] - KIND_ORDER[right.hit.select.kind] ||
      left.hit.label.localeCompare(right.hit.label))
    .slice(0, limit)
    .map((entry) => entry.hit);
}
