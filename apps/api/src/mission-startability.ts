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
 *                  its own route and its own decision. Nor is one that
 *                  already has a job on the queue: it is running, or about
 *                  to, and a second start would run it twice.
 *   readiness      whether the steps that are still to run would really be
 *                  routed, which the mission preflight works out. Only a
 *                  blocker refuses; a limitation says how complete the answer
 *                  will be, and a step that will wait for a person is a gate
 *                  the run stops at, not a reason not to begin. Both are
 *                  still said, as the state of a start that is allowed.
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

/** What a start that is allowed will be like. */
export type StartState =
  /** Nothing stands in the way and nothing will stop it for a person. */
  | "ready"
  /** It can run, but something may make the result less complete. */
  | "limited"
  /** It can run, and will stop at a step that waits for a person. */
  | "approval_required";

export type StartRefusal =
  | "not_planned"
  | "planning"
  | "waiting_approval"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "blocked";

export type Startability =
  | { startable: true; mode: StartMode; state: StartState; message: string }
  | { startable: false; reason: StartRefusal; message: string };

/** The lifecycle's answer on its own, before readiness is known. */
export type LifecycleStartability =
  | { startable: true; mode: StartMode }
  | { startable: false; reason: StartRefusal; message: string };

/** What the preflight found about the steps still to run. */
export interface StartReadiness {
  blocked: boolean;
  /** The first blocker, in a person's words. */
  summary?: string;
  /** What may make the result less complete, in a person's words. */
  limitation?: string;
  /** How many of the steps still to run will wait for a person. */
  approvals?: number;
}

/**
 * The lifecycle half, from the mission's status, whether it has steps and
 * whether a job for it is already queued or running. Needs nothing else, so
 * it is also what answers first when the rest would be wasted work.
 */
export function lifecycleStartability(
  work: Pick<Work, "status">,
  stepCount: number,
  hasActiveJob = false,
): LifecycleStartability {
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
      if (hasActiveJob) {
        return refuse("running", "This mission is already running, or waiting for a worker to pick it up.");
      }

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
  hasActiveJob = false,
): Startability {
  const lifecycle = lifecycleStartability(work, stepCount, hasActiveJob);

  if (!lifecycle.startable) return lifecycle;

  if (readiness.blocked) {
    return refuse(
      "blocked",
      readiness.summary ?? "Something this mission needs is not in place, so it cannot run yet.",
    );
  }

  const approvals = readiness.approvals ?? 0;
  const gate = approvals > 0
    ? `It will stop for approval at ${approvals === 1 ? "1 step" : `${approvals} steps`}.`
    : undefined;

  // A limit is the one thing that changes what the person gets back, so it
  // names the state; a gate is part of the plan and is said beside it.
  if (readiness.limitation) {
    return { ...lifecycle, state: "limited", message: gate ? `${readiness.limitation} ${gate}` : readiness.limitation };
  }

  if (gate) {
    return { ...lifecycle, state: "approval_required", message: gate };
  }

  return {
    ...lifecycle,
    state: "ready",
    message: lifecycle.mode === "resume"
      ? "Ready to carry on from where it stopped."
      : "Ready to run.",
  };
}

function refuse(reason: StartRefusal, message: string): { startable: false; reason: StartRefusal; message: string } {
  return { startable: false, reason, message };
}
