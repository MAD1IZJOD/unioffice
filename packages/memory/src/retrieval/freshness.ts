import type { Memory, MemoryType } from "@unioffice/core";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long each kind of knowledge stays current before it should be read with
 * suspicion.
 *
 * Age means different things for different knowledge. A policy is in force
 * until someone archives it, however old it is. An assumption made two months
 * ago is exactly the thing that has most likely stopped being true. Treating
 * them the same would either let assumptions linger or make standing rules
 * look stale.
 *
 * null means "does not go stale with age".
 */
export const FRESHNESS_HORIZON_DAYS: Record<MemoryType, number | null> = {
  policy: null,
  process: 365,
  preference: 365,
  reference: 365,
  fact: 180,
  decision: 180,
  lesson: 180,
  insight: 90,
  assumption: 60,
  experience: 30,
};

export interface Freshness {
  ageDays: number;
  /** 0-1, halving every half-horizon. Always 1 for knowledge that does not age. */
  recency: number;
  /** Past its horizon. Still retrievable - flagged, never silently dropped. */
  stale: boolean;
  horizonDays: number | null;
}

/**
 * Measured from the last time the knowledge was changed or reviewed, not from
 * when it was first written: a decision someone re-confirmed last week is
 * fresh even if it was first recorded a year ago.
 */
export function freshnessOf(memory: Memory, now: Date): Freshness {
  const lastConfirmed = Math.max(
    memory.updatedAt.getTime(),
    memory.reviewedAt?.getTime() ?? 0,
    memory.createdAt.getTime(),
  );

  const ageDays = Math.max(0, (now.getTime() - lastConfirmed) / DAY_MS);
  // `in` rather than `??`: null is a deliberate "never goes stale", and `??`
  // would quietly turn it into the default horizon.
  const horizonDays =
    memory.type in FRESHNESS_HORIZON_DAYS
      ? FRESHNESS_HORIZON_DAYS[memory.type]
      : 180;

  if (horizonDays === null) {
    return { ageDays, recency: 1, stale: false, horizonDays };
  }

  return {
    ageDays,
    recency: Math.pow(0.5, ageDays / (horizonDays / 2)),
    stale: ageDays > horizonDays,
    horizonDays,
  };
}
