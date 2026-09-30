import type { ActivityEvent, WorldSnapshot } from "../lib/api";
import { describeEvent } from "../lib/events";

/**
 * What the company's record says the people in the office did recently.
 *
 * The office itself only ever moves for what changed while it was watched.
 * This is the other half: the events the server recorded before the page was
 * opened, read as lines and never acted out. Only events about an agent in
 * this viewer's office are kept - the activity feed lets through events that
 * belong to no mission, and the World hides agents in workspaces the viewer
 * cannot reach, so an event is shown only when its agent is drawn here.
 */

export interface RecentEntry {
  key: string;
  at: string;
  agentId: string;
  line: string;
  detail?: string;
}

/**
 * Requested and reported: a tool call is recorded twice, and the second says
 * what happened. Assignment is told by the step starting.
 */
const SKIPPED = new Set(["tool.called", "agent.assigned"]);

export const MAX_RECENT = 8;

export function recentInWorld(events: readonly ActivityEvent[], snapshot: WorldSnapshot): RecentEntry[] {
  const names = new Map(snapshot.agents.map((agent) => [agent.id, agent.name]));

  return [...events]
    .filter((event) => event.agentId !== undefined && names.has(event.agentId) && !SKIPPED.has(event.type))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_RECENT)
    .map((event) => {
      const described = describeEvent(event);
      const name = names.get(event.agentId!)!;
      // Some lines already start with the agent - "Jessica joined the workforce".
      const line = described.title.startsWith(name) ? described.title : `${name} · ${described.title}`;

      return { key: event.id, at: event.timestamp, agentId: event.agentId!, line, detail: described.detail };
    });
}
