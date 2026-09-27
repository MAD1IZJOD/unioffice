import type { Work } from "@unioffice/core";

/**
 * Whether a person may start a mission now, as one answer.
 *
 * The brief, the execution room and the execute route used to answer this
 * three ways. The brief re-checked every step against the company and could
 * say a mission was blocked while the room, which only looked at the
 * mission's status, offered to run it - and the route queued it for either
 * of them without asking. This is the one decision all three read.
 *
 * Two things decide it, in order:
 *
 *   the lifecycle  whether the mission is somewhere a start can apply to at
 *                  all - planned and waiting, or started and left without a
 *                  worker. A finished, cancelled or failed mission is not
 *                  started again from here; a failed one has retry, which is
 *                  its own route and its own decision.
 *   readiness      whether the steps that are still to run would really be
 *                  routed, which the mission preflight works out. Only a
 *                  blocker refuses; a limitation says how complete the answer
 *                  will be, and a step that will wait for a person is a gate
 *                  the run stops at, not a reason not to begin.
 *
 * Approvals resuming a run, retries and schedules put their work on the queue
 * themselves and never come through here. This is the gate on a person
 * pressing start, not on execution.
 */

export type StartMode =
  /** Planned and not begun. */
  | "start"
  /** Begun, and left without anything running it. */
  | "resume";

export type StartRefusal =
  | "not_planned"
  | "planning"
  | "waiting_approval"
  | "completed"
  | "cancelled"
  | "failed"
  | "blocked";

export type Startability =
  | { startable: true; mode: StartMode }
  | { startable: false; reason: StartRefusal; message: string };

/** What the preflight found about the steps still to run. */
export interface StartReadiness {
  blocked: boolean;
  /** The first blocker, in a person's words. */
  summary?: string;
}

/**
 * The lifecycle half, from the mission's status and whether it has steps.
 * Needs no reads, so it is also what answers first when the rest would be
 * wasted work.
 */
export function lifecycleStartability(
  work: Pick<Work, "status">,
  stepCount: number,
): Startability {
  switch (work.status) {
    case "planning":
      return refuse("planning", "This mission is still being planned.");
    case "waiting_approval":
      return refuse(
        "waiting_approval",
        "This mission is waiting on a decision. It carries on once the step is decided.",
      );
    case "completed":
      return refuse("completed", "This mission has already finished.");
    case "cancelled":
      return refuse("cancelled", "This mission was cancelled, so it cannot be started again.");
    case "failed":
      return refuse("failed", "This mission stopped. Retry it rather than starting it again.");
    case "queued":
    case "executing":
      if (stepCount === 0) {
        return refuse("not_planned", "This mission has no plan yet, so there is nothing to run.");
      }

      return { startable: true, mode: work.status === "queued" ? "start" : "resume" };
  }
}

/** The whole decision: the lifecycle, then what the preflight found. */
export function startabilityOf(
  work: Pick<Work, "status">,
  stepCount: number,
  readiness: StartReadiness,
): Startability {
  const lifecycle = lifecycleStartability(work, stepCount);

  if (!lifecycle.startable) return lifecycle;

  if (readiness.blocked) {
    return refuse(
      "blocked",
      readiness.summary ?? "Something this mission needs is not in place, so it cannot run yet.",
    );
  }

  return lifecycle;
}

function refuse(reason: StartRefusal, message: string): Startability {
  return { startable: false, reason, message };
}
