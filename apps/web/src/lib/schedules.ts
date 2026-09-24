import type {
  ContinuousMissionItem,
  MissionRunLink,
  ContinuousMissionRunSummary,
  MissionScheduleSpec,
  RunState,
  ScheduleCadence,
} from "./api";

import type { Tone } from "./tone";

/**
 * Reading continuous missions.
 *
 * What a run's state is, and why a schedule paused itself, are the server's
 * answers. This file only chooses the words and colours they wear, and says
 * a future moment the way a person would.
 */

export const CADENCE_LABEL: Record<ScheduleCadence, string> = {
  hourly: "Every hour",
  daily: "Every day",
  weekdays: "Monday to Friday",
  weekly: "Every week",
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const RUN_STATE_LABEL: Record<RunState, string> = {
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  completed: "Completed",
  completed_with_limitations: "Completed with limitations",
  blocked: "Blocked by a rule",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function runTone(state: RunState): Tone {
  switch (state) {
    case "completed":
      return "live";
    case "running":
      return "active";
    case "waiting_for_approval":
    case "completed_with_limitations":
      return "warning";
    case "blocked":
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

/** Where the schedule stands, in a word and a colour. */
export function scheduleStanding(mission: Pick<ContinuousMissionItem, "status" | "pauseReason">): { label: string; tone: Tone } {
  if (mission.status === "active") return { label: "Running on schedule", tone: "live" };
  if (mission.status === "cancelled") return { label: "Cancelled", tone: "idle" };

  return mission.pauseReason === "person"
    ? { label: "Paused", tone: "idle" }
    : { label: "Stopped itself", tone: "error" };
}

/** "Run 3", with how it started when a person asked for it. */
export function runTitle(run: Pick<ContinuousMissionRunSummary, "sequence" | "trigger">): string {
  return run.trigger === "manual" ? `Run ${run.sequence} · started by hand` : `Run ${run.sequence}`;
}

/**
 * A moment either side of now, the way a person says it: "in 3 days",
 * "in 40 minutes", "2h ago". The exact time goes in a title attribute.
 */
export function formatWhen(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "—";

  const delta = new Date(iso).getTime() - now;
  if (!Number.isFinite(delta)) return "—";

  const ahead = delta >= 0;
  const minutes = Math.round(Math.abs(delta) / 60_000);

  const phrase = minutes < 1
    ? undefined
    : minutes < 60
      ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}`
      : minutes < 60 * 36
        ? `${Math.round(minutes / 60)} ${Math.round(minutes / 60) === 1 ? "hour" : "hours"}`
        : `${Math.round(minutes / (60 * 24))} days`;

  if (!phrase) return ahead ? "any moment now" : "just now";

  return ahead ? `in ${phrase}` : `${phrase} ago`;
}

/** The exact local time of a moment, for a title or a line of detail. */
export function formatExact(iso: string | undefined): string {
  if (!iso) return "";

  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The browser's own timezone, which is the sensible default for a new schedule. */
export function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Every timezone this browser knows, for the picker; the local one when it cannot list them. */
export function knownTimezones(): string[] {
  const local = localTimezone();

  try {
    const zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones.includes(local) ? zones : [local, ...zones];
  } catch {
    // Older engines cannot list them; the local zone is still a valid answer.
  }

  return [local, "UTC"].filter((zone, index, all) => all.indexOf(zone) === index);
}

/**
 * The schedule a form describes, with only the fields its cadence uses, so
 * what is sent is exactly what the server will store and show back.
 */
export function scheduleFrom(form: {
  cadence: ScheduleCadence;
  dayOfWeek: number;
  time: string;
  minuteOfHour: number;
  timezone: string;
}): MissionScheduleSpec {
  if (form.cadence === "hourly") {
    return { cadence: "hourly", minute: form.minuteOfHour, timezone: form.timezone };
  }

  const [hour, minute] = form.time.split(":").map((part) => Number(part));

  return {
    cadence: form.cadence,
    ...(form.cadence === "weekly" ? { dayOfWeek: form.dayOfWeek } : {}),
    hour: Number.isInteger(hour) ? hour : 9,
    minute: Number.isInteger(minute) ? minute : 0,
    timezone: form.timezone,
  };
}

/**
 * The run a mission is, from the link the scheduler wrote on it. Anything
 * short of the whole shape reads as no run, the same rule the server uses.
 */
export function runLinkOf(metadata: Record<string, unknown> | undefined): MissionRunLink | undefined {
  const link = metadata?.continuousMission;
  if (typeof link !== "object" || link === null) return undefined;

  const { id, name, sequence } = link as Record<string, unknown>;
  const number = typeof sequence === "number" ? sequence : Number(sequence);

  if (typeof id !== "string" || typeof name !== "string" || !name.trim() || !Number.isInteger(number) || number < 1) {
    return undefined;
  }

  return { continuousMissionId: id, name: name.trim(), sequence: number };
}
