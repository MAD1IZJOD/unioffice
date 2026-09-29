import { pathBetween, type FloorPlan, type Point } from "./layout";
import type { WorldMoment } from "./moments";

/**
 * What crosses the office floor, and why.
 *
 * Only two things ever move, and each is the telling of a moment the page
 * watched happen between two live readings (see moments.ts):
 *
 *   a walk   work changing hands. The agent who finished the step gets up,
 *            carries the result to the desk of the agent whose step uses it,
 *            sets it down and walks back. The handoff is a fact the task rows
 *            record - one step's result became another step's input - so the
 *            walk is how the office shows that fact, not a meeting nobody
 *            had.
 *   slips    a plan giving out its steps, carried from the planner's desk to
 *            each agent it gave work to.
 *
 * Nothing else produces a trip: an agent starting, finishing or waiting on a
 * decision changes their desk, never their place. There is no timer here and
 * no randomness - the same moments on the same floor plan always make the
 * same trips.
 */

export type Travel =
  | {
      key: string;
      kind: "walk";
      /** Who walks. Their desk stands empty until they are back. */
      agentId: string;
      /** Desk to desk, one way. The walk back retraces it. */
      points: Point[];
      delay: number;
      /**
       * When the walk before it ended, on the page's clock, for a walk that
       * waited its turn. It sets off from then rather than from when it was
       * first drawn, so a queue left while the page could not draw is not
       * replayed late.
       */
      after?: number;
    }
  | {
      key: string;
      kind: "slip";
      points: Point[];
      /** Milliseconds before it sets off, so several slips leave one by one. */
      delay: number;
    };

export function travelsOf(moments: WorldMoment[], plan: FloorPlan): Travel[] {
  const trips: Travel[] = [];

  for (const moment of moments) {
    if (moment.kind === "handoff") {
      const { from, to } = moment.handoff;
      const points = pathBetween(plan, from.id, to.id);

      // Either end off the plan - someone the viewer cannot see - and
      // nobody walks.
      if (points) trips.push({ key: moment.key, kind: "walk", agentId: from.id, points, delay: 0 });
    }

    if (moment.kind === "assigned" && moment.fromAgentId) {
      moment.toAgentIds.forEach((agentId, index) => {
        const points = pathBetween(plan, moment.fromAgentId!, agentId);
        if (points) trips.push({ key: `${moment.key}:${agentId}`, kind: "slip", points, delay: index * 220 });
      });
    }
  }

  return trips;
}

/** Whoever is away from their desk right now, carrying work. */
export function walkersOf(travels: Travel[]): Set<string> {
  return new Set(travels.flatMap((travel) => (travel.kind === "walk" ? [travel.agentId] : [])));
}

/**
 * The trips to draw now. One step's result can feed several steps, so one
 * agent may have more than one walk to make; there is only one of them, so
 * they make those walks one after another. Each later walk waits, off the
 * floor, until the one before it is done. Slips all go at once.
 */
export function underway(travels: Travel[]): Travel[] {
  const walking = new Set<string>();

  return travels.filter((travel) => {
    if (travel.kind !== "walk") return true;
    if (walking.has(travel.agentId)) return false;

    walking.add(travel.agentId);
    return true;
  });
}

/**
 * The trips left once one is over. A finished walk hands its end time to
 * the same agent's next walk, which sets off from there. No other trip is
 * touched, so nothing under way is restarted or cut short.
 */
export function finish(travels: Travel[], key: string, endedAt: number): Travel[] {
  const done = travels.find((travel) => travel.key === key);
  const rest = travels.filter((travel) => travel.key !== key);
  if (done?.kind !== "walk") return rest;

  const next = rest.findIndex((travel) => travel.kind === "walk" && travel.agentId === done.agentId);
  return rest.map((travel, index) => (index === next ? { ...travel, after: endedAt } : travel));
}
