import type { WorldAgent, WorldSnapshot } from "../lib/api";
import { PRESENCE } from "../lib/workforce";

import { deskStateOf, recentFailure } from "./describe";

/**
 * Showing only the agents in some states.
 *
 * Every filter is one of the states the office already draws, and each of
 * those is something the server records: a running step, a step held for a
 * decision, the planner writing a plan, the agent's own status, and a last
 * step that could not finish. There is no "blocked" here because nothing in
 * UNIOFFICE records an agent as blocked - a blocker belongs to a mission's
 * steps, and the mission brief is where it is shown.
 *
 * Picking none keeps everyone; picking several keeps an agent in any of
 * them. The labels are the workforce's own words for the same states.
 */

export type AgentFilter = "working" | "waiting" | "planning" | "available" | "off" | "failed";

export const AGENT_FILTERS: ReadonlyArray<{ id: AgentFilter; label: string }> = [
  { id: "working", label: PRESENCE.working.label },
  { id: "waiting", label: PRESENCE.waiting.label },
  { id: "planning", label: "Writing a plan" },
  { id: "available", label: PRESENCE.available.label },
  { id: "off", label: "Paused or unavailable" },
  { id: "failed", label: "Last step failed" },
];

export function matchesFilter(agent: WorldAgent, filter: AgentFilter, asOf: string): boolean {
  const state = deskStateOf(agent);

  switch (filter) {
    case "working":
      return state === "working" || state === "elsewhere";
    case "waiting":
      return state === "waiting";
    case "planning":
      return state === "planning";
    case "available":
      return state === "available";
    case "off":
      return state === "paused" || state === "unavailable";
    case "failed":
      return recentFailure(agent, asOf);
    default:
      // A filter this build does not know - an old link, say - keeps nobody
      // rather than being guessed at.
      return false;
  }
}

/** Whether an agent is kept by the filters picked. None picked keeps everyone. */
export function keeps(agent: WorldAgent, filters: ReadonlySet<AgentFilter>, asOf: string): boolean {
  if (filters.size === 0) return true;
  return [...filters].some((filter) => matchesFilter(agent, filter, asOf));
}

/** How many agents each filter would keep, from the snapshot as it is. */
export function filterCounts(snapshot: WorldSnapshot): Record<AgentFilter, number> {
  const counts = Object.fromEntries(AGENT_FILTERS.map(({ id }) => [id, 0])) as Record<AgentFilter, number>;

  for (const agent of snapshot.agents) {
    for (const { id } of AGENT_FILTERS) {
      if (matchesFilter(agent, id, snapshot.generatedAt)) counts[id] += 1;
    }
  }

  return counts;
}
