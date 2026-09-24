import type {
  ContinuousMissionId,
  ContinuousMissionRunId,
  OrganizationId,
  UserId,
  WorkId,
  WorkspaceId,
} from "../types/ids.js";

import type { WorkPriority } from "./work.js";

/**
 * A mission the company runs again and again.
 *
 * "Check competitor pricing every Monday and tell me if something material
 * changed" is not one mission, it is a standing instruction that produces one
 * each week. This is the instruction - what to do, how often, whose it is and
 * whether it is running - and it never executes anything itself. Each time it
 * comes due it starts an ordinary mission, a run, which is planned, governed,
 * approved and executed exactly like one a person started by hand, and which
 * keeps its own plan, steps, approvals, results and failure.
 *
 * So a run failing is a fact about that run. The instruction goes on as it
 * was; only if its runs keep failing does it stop itself and say so.
 */

/**
 * How often. Deliberately a few plain shapes rather than a cron expression:
 * a person has to be able to read back what they set and know what it means.
 *
 *   hourly    at `minute` past every hour
 *   daily     every day at `hour`:`minute`
 *   weekdays  Monday to Friday at `hour`:`minute`
 *   weekly    every `dayOfWeek` at `hour`:`minute`
 *
 * Times are in `timezone`, the company's clock rather than the server's, so
 * "9 in the morning" stays 9 in the morning across a daylight-saving change.
 */
export type MissionCadence = "hourly" | "daily" | "weekdays" | "weekly";

export interface MissionSchedule {
  cadence: MissionCadence;
  /** 0 is Sunday. Only for weekly. */
  dayOfWeek?: number;
  /** 0-23. Not for hourly. */
  hour?: number;
  /** 0-59. */
  minute: number;
  /** An IANA timezone, such as "Asia/Kolkata". */
  timezone: string;
}

/**
 * active     it starts a run each time it comes due
 * paused     it is kept, and starts nothing until resumed
 * cancelled  it is finished with; its runs remain on record
 */
export type ContinuousMissionStatus = "active" | "paused" | "cancelled";

/**
 * Why a paused mission is paused:
 *
 *   person             someone paused it
 *   repeated_failures  it stopped itself, because its runs kept failing and
 *                      starting more would only fail again
 *   owner_access       it stopped itself, because the person it runs for can
 *                      no longer start missions there - a schedule never
 *                      outlives the permission it was created under
 */
export type ContinuousMissionPauseReason = "person" | "repeated_failures" | "owner_access";

export interface ContinuousMission {
  id: ContinuousMissionId;
  organizationId: OrganizationId;
  workspaceId?: WorkspaceId;

  /** Whose it is. Every run is requested in their name. */
  ownerId: UserId;

  /** What a person calls it: "Competitor pricing watch". */
  name: string;

  /** What each run is asked to do. */
  objective: string;

  /** Constraints the owner wrote, handed to every run's planner. */
  briefing?: string;

  priority: WorkPriority;

  schedule: MissionSchedule;

  status: ContinuousMissionStatus;

  pauseReason?: ContinuousMissionPauseReason;

  /** When the next run is due. Set exactly while the mission is active. */
  nextRunAt?: Date;

  /** When the latest run was started, by schedule or by hand. */
  lastRunAt?: Date;

  /** How many runs it has started. The next run is number runCount + 1. */
  runCount: number;

  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
  metadata: Record<string, unknown>;
}

/**
 * started by the schedule coming due, or by a person asking for a run now
 */
export type ContinuousMissionRunTrigger = "schedule" | "manual";

/**
 * One time a continuous mission ran.
 *
 * Only the link: which instruction, which occurrence, which mission row. Its
 * state - planning, waiting on a person, finished, failed - is the mission
 * row's own, read from there, so a run never has two statuses that could
 * disagree.
 */
export interface ContinuousMissionRun {
  id: ContinuousMissionRunId;
  organizationId: OrganizationId;
  continuousMissionId: ContinuousMissionId;
  workId: WorkId;
  /** 1 for the first run, and so on. */
  sequence: number;
  /**
   * The occurrence this run is for. Unique per continuous mission, which is
   * what stops the same occurrence being run twice however many times a
   * scheduler looks at it.
   */
  scheduledFor: Date;
  trigger: ContinuousMissionRunTrigger;
  createdAt: Date;
}

/** Consecutive failed runs after which a mission stops itself. */
export const REPEATED_FAILURE_LIMIT = 3;

export const MISSION_CADENCES: readonly MissionCadence[] = ["hourly", "daily", "weekdays", "weekly"];

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Refuses a schedule that cannot mean anything. Returns the reason, in words
 * the person who set it can act on, or undefined when it is sound.
 */
export function scheduleProblem(schedule: MissionSchedule): string | undefined {
  if (!MISSION_CADENCES.includes(schedule.cadence)) {
    return "How often must be hourly, daily, weekdays or weekly.";
  }

  if (!Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) {
    return "The minute must be a whole number from 0 to 59.";
  }

  if (schedule.cadence !== "hourly") {
    if (schedule.hour === undefined || !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23) {
      return "The hour must be a whole number from 0 to 23.";
    }
  } else if (schedule.hour !== undefined) {
    return "An hourly schedule takes a minute past the hour, not an hour.";
  }

  if (schedule.cadence === "weekly") {
    if (schedule.dayOfWeek === undefined || !Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
      return "A weekly schedule needs a day of the week.";
    }
  } else if (schedule.dayOfWeek !== undefined) {
    return "Only a weekly schedule takes a day of the week.";
  }

  if (!isTimezone(schedule.timezone)) {
    return `${schedule.timezone || "That"} is not a timezone this server knows.`;
  }

  return undefined;
}

export function isTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 64) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first occurrence strictly after `after`.
 *
 * Pure: the same schedule and instant always give the same answer, which is
 * what lets two schedulers agree on which occurrence is due without talking to
 * each other. Worked in the schedule's own timezone, so an occurrence is the
 * wall-clock time a person chose. A time that does not exist on a given day
 * because the clocks went forward is taken at the equivalent instant after
 * the jump; one that happens twice when they go back is taken the first time.
 */
export function nextOccurrence(schedule: MissionSchedule, after: Date): Date {
  const problem = scheduleProblem(schedule);
  if (problem) throw new Error(problem);

  const start = wallClock(after, schedule.timezone);

  if (schedule.cadence === "hourly") {
    // Walk wall-clock hours forward; a day has at most 25 of them.
    for (let offset = 0; offset <= 48; offset += 1) {
      const candidate = instantOf(
        { ...start, hour: start.hour + offset, minute: schedule.minute },
        schedule.timezone,
      );
      if (candidate.getTime() > after.getTime()) return candidate;
    }

    throw new Error("No hourly occurrence found; the timezone data is inconsistent.");
  }

  // Walk calendar days forward; a week covers every cadence.
  for (let offset = 0; offset <= 8; offset += 1) {
    const day = addDays(start, offset);
    const weekday = dayOfWeek(day);

    if (schedule.cadence === "weekdays" && (weekday === 0 || weekday === 6)) continue;
    if (schedule.cadence === "weekly" && weekday !== schedule.dayOfWeek) continue;

    const candidate = instantOf(
      { ...day, hour: schedule.hour!, minute: schedule.minute },
      schedule.timezone,
    );

    if (candidate.getTime() > after.getTime()) return candidate;
  }

  throw new Error("No occurrence found in the coming week; the timezone data is inconsistent.");
}

/** The schedule as a person reads it: "Every Monday at 09:00 (Asia/Kolkata)". */
export function describeSchedule(schedule: MissionSchedule): string {
  const time = `${pad(schedule.hour ?? 0)}:${pad(schedule.minute)}`;

  switch (schedule.cadence) {
    case "hourly":
      return `Every hour at ${pad(schedule.minute)} past (${schedule.timezone})`;
    case "daily":
      return `Every day at ${time} (${schedule.timezone})`;
    case "weekdays":
      return `Monday to Friday at ${time} (${schedule.timezone})`;
    case "weekly":
      return `Every ${DAY_NAMES[schedule.dayOfWeek ?? 0]} at ${time} (${schedule.timezone})`;
  }
}

/* --------------------------------------------------------------------------
   Wall-clock arithmetic
   -------------------------------------------------------------------------- */

interface WallClock {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallClock(instant: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);

  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

/** How far ahead of UTC the timezone's clock is at an instant, in minutes. */
function offsetMinutes(instant: Date, timezone: string): number {
  const clock = wallClock(instant, timezone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;

  return Math.round((asUtc - truncated) / 60_000);
}

/**
 * The instant a wall-clock time happens in a timezone. Fields may overflow
 * ("hour 25" is 1 the next day); Date.UTC normalises them.
 */
function instantOf(clock: WallClock, timezone: string): Date {
  const naive = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);

  // Two passes: the offset at the naive guess, then at the corrected
  // instant, which settles every case but a skipped hour. A skipped time
  // lands after the jump, which is what a person means by "9:30" on the
  // morning the clocks went forward past it.
  const first = naive - offsetMinutes(new Date(naive), timezone) * 60_000;
  const second = naive - offsetMinutes(new Date(first), timezone) * 60_000;

  // A time that happens twice matches both; the earlier is the first time.
  const matching = [first, second].filter((candidate) => wallMatches(candidate, clock, timezone));
  if (matching.length > 0) return new Date(Math.min(...matching));

  // Neither shows that time, so the clocks skipped it: the later candidate
  // is the same instant after the jump.
  return new Date(Math.max(first, second));
}

function wallMatches(instant: number, clock: WallClock, timezone: string): boolean {
  const normalised = new Date(Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute));
  const actual = wallClock(new Date(instant), timezone);

  return (
    actual.year === normalised.getUTCFullYear() &&
    actual.month === normalised.getUTCMonth() + 1 &&
    actual.day === normalised.getUTCDate() &&
    actual.hour === normalised.getUTCHours() &&
    actual.minute === normalised.getUTCMinutes()
  );
}

function addDays(clock: WallClock, days: number): WallClock {
  const date = new Date(Date.UTC(clock.year, clock.month - 1, clock.day + days));

  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0 };
}

function dayOfWeek(clock: WallClock): number {
  return new Date(Date.UTC(clock.year, clock.month - 1, clock.day)).getUTCDay();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
