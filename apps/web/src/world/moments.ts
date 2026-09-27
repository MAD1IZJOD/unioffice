import type { WorldAgent, WorldHandoff, WorldSnapshot } from "../lib/api";

/**
 * What changed in the world while someone was watching it.
 *
 * The world never animates a guess. Everything that moves on the page is one
 * of these, and each one is the difference between two snapshots the server
 * returned - so it is something that really happened between two readings of
 * the company, told in the order the page saw it.
 *
 * Two readings only count as consecutive when the page was connected for
 * both of them and nothing interrupted the connection in between. The first
 * reading after opening the page, after a reconnect or after a long gap is a
 * starting point instead: the office is drawn as it is, and nothing is
 * replayed, because the page cannot know what order things happened in while
 * it was not listening.
 */

export type WorldMoment =
  | {
      kind: "handoff";
      key: string;
      handoff: WorldHandoff;
    }
  | {
      kind: "assigned";
      key: string;
      missionId: string;
      missionName: string;
      /** The planner, when the caller can see them. */
      fromAgentId?: string;
      toAgentIds: string[];
    }
  | {
      kind: "planning";
      key: string;
      agentId: string;
      missionId: string;
      missionName: string;
    }
  | {
      kind: "started";
      key: string;
      agentId: string;
      missionId?: string;
      missionName?: string;
      taskTitle?: string;
    }
  | {
      kind: "waiting";
      key: string;
      agentId: string;
      missionId?: string;
      missionName?: string;
      taskTitle?: string;
    }
  | {
      kind: "finished";
      key: string;
      agentId: string;
      outcome: "completed" | "failed";
      missionId: string;
      missionName: string;
      taskTitle: string;
    };

/** One snapshot, and how the page came to have it. */
export interface Reading {
  snapshot: WorldSnapshot;
  /** When the page received it, by the page's clock. */
  receivedAt: number;
  /** Whether the live channel was carrying events when it arrived. */
  live: boolean;
  /**
   * Which unbroken connection it arrived on. The page counts up each time
   * the channel comes back after dropping, so two readings from different
   * connections are never treated as consecutive.
   */
  connection: number;
}

/**
 * The longest two readings can be apart and still be told as a sequence.
 * A connected page re-reads at least every thirty seconds; anything longer
 * means something held the page up, and the difference is no longer a story
 * anyone watched.
 */
export const CONTINUITY_MS = 90_000;

/** Whether the change from one reading to the next may be shown as motion. */
export function continuous(previous: Reading | undefined, next: Reading): boolean {
  return (
    previous !== undefined &&
    previous.live &&
    next.live &&
    previous.connection === next.connection &&
    next.receivedAt >= previous.receivedAt &&
    next.receivedAt - previous.receivedAt <= CONTINUITY_MS &&
    previous.snapshot.organizationId === next.snapshot.organizationId
  );
}

export function handoffKey(handoff: WorldHandoff): string {
  return `${handoff.missionId}:${handoff.fromStep.number}>${handoff.toStep.number}`;
}

/**
 * Everything that changed between two consecutive readings, in a stable
 * order. Nothing when the readings are not consecutive.
 */
export function momentsBetween(previous: Reading | undefined, next: Reading): WorldMoment[] {
  if (!continuous(previous, next)) return [];

  const before = previous!.snapshot;
  const after = next.snapshot;
  const moments: WorldMoment[] = [];
  const stamp = after.generatedAt;

  /* Work changing hands --------------------------------------------------- */
  const known = new Set(before.handoffs.map(handoffKey));

  for (const handoff of after.handoffs) {
    const key = handoffKey(handoff);
    if (!known.has(key)) moments.push({ kind: "handoff", key: `handoff:${key}`, handoff });
  }

  /* A plan handing out its steps ------------------------------------------ */
  const planner = after.agents.find((agent) => agent.type === "orchestrator");
  const missionsBefore = new Map(before.missions.map((mission) => [mission.id, mission]));

  for (const mission of after.missions) {
    const was = missionsBefore.get(mission.id);
    const justPlanned =
      mission.status !== "planning" &&
      mission.agentIds.length > 0 &&
      (was === undefined ? plannedBy(before, mission.id) : was.status === "planning" || was.agentIds.length === 0);

    if (!justPlanned) continue;

    moments.push({
      kind: "assigned",
      key: `assigned:${mission.id}:${stamp}`,
      missionId: mission.id,
      missionName: mission.name,
      fromAgentId: planner?.id,
      toAgentIds: mission.agentIds.filter((agentId) => agentId !== planner?.id),
    });
  }

  /* Each agent's own state ------------------------------------------------ */
  const agentsBefore = new Map(before.agents.map((agent) => [agent.id, agent]));

  for (const agent of after.agents) {
    const was = agentsBefore.get(agent.id);
    if (!was) continue;

    if (agent.planning && agent.planning.missionId !== was.planning?.missionId) {
      moments.push({
        kind: "planning",
        key: `planning:${agent.id}:${agent.planning.missionId}`,
        agentId: agent.id,
        missionId: agent.planning.missionId,
        missionName: agent.planning.missionName,
      });
    }

    if (finishedSomething(was, agent)) {
      const outcome = agent.lastOutcome!;

      moments.push({
        kind: "finished",
        key: `finished:${agent.id}:${outcome.missionId}:${outcome.at}`,
        agentId: agent.id,
        outcome: outcome.outcome,
        missionId: outcome.missionId,
        missionName: outcome.missionName,
        taskTitle: outcome.taskTitle,
      });
    }

    const tookUp = agent.presence !== was.presence || onAnotherStep(was, agent);

    if (tookUp && agent.presence === "working") {
      moments.push({
        kind: "started",
        key: `started:${agent.id}:${agent.current?.missionId ?? "elsewhere"}:${agent.current?.taskTitle ?? ""}:${stamp}`,
        agentId: agent.id,
        missionId: agent.current?.missionId,
        missionName: agent.current?.missionName,
        taskTitle: agent.current?.taskTitle,
      });
    }

    if (tookUp && agent.presence === "waiting") {
      moments.push({
        kind: "waiting",
        key: `waiting:${agent.id}:${agent.current?.missionId ?? "elsewhere"}:${agent.current?.taskTitle ?? ""}:${stamp}`,
        agentId: agent.id,
        missionId: agent.current?.missionId,
        missionName: agent.current?.missionName,
        taskTitle: agent.current?.taskTitle,
      });
    }
  }

  return moments;
}

/** Whether the planner was writing this mission's plan in the earlier reading. */
function plannedBy(snapshot: WorldSnapshot, missionId: string): boolean {
  return snapshot.agents.some((agent) => agent.planning?.missionId === missionId);
}

function finishedSomething(was: WorldAgent, now: WorldAgent): boolean {
  const last = now.lastOutcome;
  if (!last) return false;

  const before = was.lastOutcome;
  return !before || before.missionId !== last.missionId || before.taskTitle !== last.taskTitle || before.at !== last.at;
}

function onAnotherStep(was: WorldAgent, now: WorldAgent): boolean {
  return (
    now.current !== undefined &&
    (was.current?.missionId !== now.current.missionId || was.current?.taskTitle !== now.current.taskTitle)
  );
}
