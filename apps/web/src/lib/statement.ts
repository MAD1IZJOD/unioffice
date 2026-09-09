import type { CompanyOverview } from "./api";

export interface CompanyStatement {
  /** The oversized line. Short, declarative, all caps at display size. */
  headline: string[];
  /** One sentence of plain detail underneath. */
  detail: string;
  /** Drives the colour of the whole composition. */
  mood: "waiting" | "moving" | "quiet" | "broken";
}

/**
 * The company's own account of what it is doing, at headline scale.
 *
 * This is the centre of the art direction and it is also the top of the
 * information hierarchy - the two are the same thing on purpose. Every word
 * is derived from live overview data, so the biggest type on the page is a
 * fact rather than a slogan, and it changes when the company changes.
 *
 * Order matters: a person being needed outranks work in progress, which
 * outranks a failure that has already happened, which outranks silence.
 */
export function describeCompany(
  overview: CompanyOverview | undefined,
): CompanyStatement {
  if (!overview) {
    return {
      headline: ["READING", "THE FLOOR."],
      detail: "Connecting to the company.",
      mood: "quiet",
    };
  }

  const waiting = overview.approvals.length;
  const executing = overview.work.active.filter(
    (work) => work.status === "executing",
  ).length;
  const queued = overview.work.active.filter(
    (work) => work.status === "queued" || work.status === "planning",
  ).length;
  const working = overview.agents.filter(
    (agent) => agent.presence === "working",
  ).length;
  const failed = overview.work.recentlyCompleted.filter(
    (work) => work.status === "failed",
  ).length;

  if (waiting > 0) {
    return {
      headline:
        waiting === 1
          ? ["A DECISION", "IS WAITING."]
          : [`${spellOut(waiting)} DECISIONS`, "ARE WAITING."],
      detail:
        waiting === 1
          ? "The company has stopped at a step it will not take without you."
          : `The company has stopped at ${waiting} steps it will not take without you.`,
      mood: "waiting",
    };
  }

  if (executing > 0) {
    return {
      headline: ["THE COMPANY", "IS MOVING."],
      detail:
        working > 0
          ? `${countOf(executing, "mission")} in flight, ${countOf(working, "agent")} working.`
          : `${countOf(executing, "mission")} in flight.`,
      mood: "moving",
    };
  }

  if (queued > 0) {
    return {
      headline:
        queued === 1
          ? ["A MISSION IS", "ON THE QUEUE."]
          : ["MISSIONS ARE", "ON THE QUEUE."],
      detail: `${countOf(queued, "mission")} waiting for a worker to pick ${
        queued === 1 ? "it" : "them"
      } up.`,
      mood: "moving",
    };
  }

  if (failed > 0) {
    return {
      headline: ["SOMETHING", "DID NOT LAND."],
      detail: `${countOf(failed, "mission")} stopped recently and can be retried.`,
      mood: "broken",
    };
  }

  if (overview.work.total > 0) {
    return {
      headline: ["THE FLOOR", "IS QUIET."],
      detail: `${countOf(overview.work.total, "mission")} run. Nothing is moving.`,
      mood: "quiet",
    };
  }

  return {
    headline: ["NOTHING HAS", "BEEN ASKED."],
    detail: "Give the company its first objective.",
    mood: "quiet",
  };
}

/** Small numbers read better as words at display size. */
export function spellOut(value: number): string {
  const words = [
    "ZERO",
    "ONE",
    "TWO",
    "THREE",
    "FOUR",
    "FIVE",
    "SIX",
    "SEVEN",
    "EIGHT",
    "NINE",
  ];

  return words[value] ?? String(value);
}

function countOf(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}
