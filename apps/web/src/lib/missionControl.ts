import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";

import {
  fetchMissionControl,
  formatRelativeTime,
  type AttentionSource,
  type MissionCard,
  type MissionControl,
  type MissionOutcome,
  type MissionPhase,
} from "./api";

import { useLiveResource, type LiveResource } from "./live";

import type { Tone } from "./tone";

/**
 * Mission Control in the browser.
 *
 * The shell reads it once and hands it to whichever page wants it, so the
 * rail, the attention drawer and the Command Center show the same state from
 * the same request. Each live event triggers one read of it, not one per
 * surface. A page rendered outside the shell - a test, say - reads it itself.
 *
 * Everything else here is presentation: words and colours for what the
 * backend already decided.
 */

export interface ShellOutletContext {
  missionControl?: LiveResource<MissionControl>;
}

/** The shell's own read. Falls back to a timer when the live channel is down. */
export function useMissionControlResource(enabled = true): LiveResource<MissionControl> {
  return useLiveResource<MissionControl>(
    useCallback(() => fetchMissionControl(), []),
    { fallbackPollMs: 20_000, enabled },
  );
}

/** The shell's read when there is a shell; a page's own otherwise. */
export function useMissionControl(): LiveResource<MissionControl> {
  const shell = useOutletContext<ShellOutletContext | undefined>();
  const own = useMissionControlResource(!shell?.missionControl);

  return shell?.missionControl ?? own;
}

/** A clock that ticks, so "updated 2m ago" keeps telling the truth. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/**
 * How old what is on screen is.
 *
 * A healthy page re-reads within about thirty seconds of anything happening.
 * Past two minutes, or once a refresh has failed, what is shown is a record of
 * the past and is labelled as one.
 */
export function freshnessOf(
  generatedAt: string,
  now: number,
  refreshFailed: boolean,
): { label: string; stale: boolean } {
  const ageMs = now - new Date(generatedAt).getTime();

  return {
    label: Number.isFinite(ageMs) && ageMs < 45_000 ? "Updated just now" : `Updated ${formatRelativeTime(generatedAt)}`,
    stale: refreshFailed || ageMs > 120_000,
  };
}

export function phaseTone(phase: MissionPhase): Tone {
  switch (phase) {
    case "running":
    case "planning":
      return "active";
    case "waiting_approval":
      return "warning";
    case "stalled":
    case "failed":
      return "error";
    case "completed":
      return "live";
    default:
      return "idle";
  }
}

const PHASE_LABEL: Record<MissionPhase, string> = {
  running: "running",
  planning: "planning",
  queued: "queued",
  waiting_approval: "needs a decision",
  stalled: "stalled",
  completed: "done",
  failed: "stopped",
  cancelled: "cancelled",
};

export function phaseLabel(phase: MissionPhase): string {
  return PHASE_LABEL[phase];
}

export function teamStateTone(state: MissionCard["team"][number]["state"]): Tone {
  switch (state) {
    case "working":
      return "active";
    case "waiting":
      return "warning";
    case "done":
      return "live";
    case "unavailable":
      return "error";
    default:
      return "idle";
  }
}

const SOURCE_LABEL: Record<AttentionSource, string> = {
  approval: "approval",
  governance: "policy",
  execution: "execution",
  planning: "planning",
  queue: "queue",
  workforce: "workforce",
  knowledge: "company brain",
};

export function sourceLabel(source: AttentionSource): string {
  return SOURCE_LABEL[source];
}

export function outcomeTone(kind: MissionOutcome["kind"]): Tone {
  switch (kind) {
    case "mission_completed":
      return "live";
    case "mission_failed":
      return "error";
    case "decision":
      return "warning";
    default:
      return "active";
  }
}

/** "under a minute", "12m", "2h 5m", "3d". */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d`;
}

export function elapsedLabel(card: MissionCard): string | undefined {
  if (card.elapsedMs === undefined) return undefined;

  const finished = card.phase === "completed" || card.phase === "failed" || card.phase === "cancelled";

  return finished ? `ran ${formatElapsed(card.elapsedMs)}` : `${formatElapsed(card.elapsedMs)} so far`;
}

export function missionTitle(card: Pick<MissionCard, "name" | "objective">): string {
  return card.name ?? card.objective;
}
