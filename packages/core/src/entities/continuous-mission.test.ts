import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSchedule,
  nextOccurrence,
  scheduleProblem,
  type MissionSchedule,
} from "./continuous-mission.js";

const kolkata = "Asia/Kolkata";
const newYork = "America/New_York";

function at(iso: string): Date {
  return new Date(iso);
}

test("a weekly schedule lands on the chosen day and time in the company's timezone", () => {
  // Monday 09:00 in Kolkata is 03:30 UTC.
  const schedule: MissionSchedule = { cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: kolkata };

  // Thursday 24 September 2026, midday UTC.
  assert.equal(nextOccurrence(schedule, at("2026-09-24T12:00:00Z")).toISOString(), "2026-09-28T03:30:00.000Z");
  // Exactly on an occurrence, the next one is a week later - never the same instant again.
  assert.equal(nextOccurrence(schedule, at("2026-09-28T03:30:00Z")).toISOString(), "2026-10-05T03:30:00.000Z");
  // A second before it, it is that one.
  assert.equal(nextOccurrence(schedule, at("2026-09-28T03:29:59Z")).toISOString(), "2026-09-28T03:30:00.000Z");
});

test("a daily schedule is the next such time, today if it has not passed", () => {
  const schedule: MissionSchedule = { cadence: "daily", hour: 18, minute: 15, timezone: kolkata };

  // 10:00 in Kolkata: later today at 18:15 (12:45 UTC).
  assert.equal(nextOccurrence(schedule, at("2026-09-24T04:30:00Z")).toISOString(), "2026-09-24T12:45:00.000Z");
  // 19:00 in Kolkata: tomorrow.
  assert.equal(nextOccurrence(schedule, at("2026-09-24T13:30:00Z")).toISOString(), "2026-09-25T12:45:00.000Z");
});

test("weekdays skip Saturday and Sunday", () => {
  const schedule: MissionSchedule = { cadence: "weekdays", hour: 8, minute: 0, timezone: kolkata };

  // Friday 25 September after 08:00 local -> Monday 28 September.
  assert.equal(nextOccurrence(schedule, at("2026-09-25T06:00:00Z")).toISOString(), "2026-09-28T02:30:00.000Z");
});

test("hourly follows the local minute, including a half-hour offset from UTC", () => {
  const schedule: MissionSchedule = { cadence: "hourly", minute: 0, timezone: kolkata };

  // On the hour in Kolkata is half past in UTC.
  assert.equal(nextOccurrence(schedule, at("2026-09-24T10:31:00Z")).toISOString(), "2026-09-24T11:30:00.000Z");
  assert.equal(nextOccurrence(schedule, at("2026-09-24T10:29:00Z")).toISOString(), "2026-09-24T10:30:00.000Z");
});

test("nine in the morning stays nine in the morning across daylight saving", () => {
  const schedule: MissionSchedule = { cadence: "daily", hour: 9, minute: 0, timezone: newYork };

  // Saturday 31 October, 08:00 EDT (UTC-4): 09:00 that morning.
  assert.equal(nextOccurrence(schedule, at("2026-10-31T12:00:00Z")).toISOString(), "2026-10-31T13:00:00.000Z");
  // Saturday 31 October, 10:00 EDT: the next 09:00 is Sunday, after the
  // clocks went back overnight, so EST (UTC-5).
  assert.equal(nextOccurrence(schedule, at("2026-10-31T14:00:00Z")).toISOString(), "2026-11-01T14:00:00.000Z");
});

test("a time the clocks skip is taken just after the jump; one they repeat, the first time", () => {
  // 8 March 2026: 02:00 EST jumps to 03:00 EDT, so 02:30 never happens.
  const skipped: MissionSchedule = { cadence: "daily", hour: 2, minute: 30, timezone: newYork };
  assert.equal(nextOccurrence(skipped, at("2026-03-08T05:00:00Z")).toISOString(), "2026-03-08T07:30:00.000Z");

  // 1 November 2026: 02:00 EDT falls back to 01:00 EST, so 01:30 happens twice.
  const repeated: MissionSchedule = { cadence: "daily", hour: 1, minute: 30, timezone: newYork };
  assert.equal(nextOccurrence(repeated, at("2026-11-01T04:00:00Z")).toISOString(), "2026-11-01T05:30:00.000Z");
});

test("occurrences always move forward and never repeat", () => {
  const schedules: MissionSchedule[] = [
    { cadence: "hourly", minute: 45, timezone: newYork },
    { cadence: "daily", hour: 1, minute: 30, timezone: newYork },
    { cadence: "weekdays", hour: 23, minute: 59, timezone: kolkata },
    { cadence: "weekly", dayOfWeek: 0, hour: 0, minute: 0, timezone: "UTC" },
  ];

  for (const schedule of schedules) {
    let cursor = at("2026-02-25T00:00:00Z");

    for (let step = 0; step < 400; step += 1) {
      const next = nextOccurrence(schedule, cursor);
      assert.ok(next.getTime() > cursor.getTime(), `${schedule.cadence} went backwards at ${cursor.toISOString()}`);
      cursor = next;
    }
  }
});

test("a schedule that cannot mean anything is refused in words", () => {
  const cases: Array<[MissionSchedule, RegExp]> = [
    [{ cadence: "yearly" as never, minute: 0, timezone: "UTC" }, /hourly, daily, weekdays or weekly/],
    [{ cadence: "daily", hour: 24, minute: 0, timezone: "UTC" }, /hour must be/],
    [{ cadence: "daily", minute: 0, timezone: "UTC" }, /hour must be/],
    [{ cadence: "daily", hour: 9, minute: 60, timezone: "UTC" }, /minute must be/],
    [{ cadence: "hourly", hour: 9, minute: 0, timezone: "UTC" }, /not an hour/],
    [{ cadence: "weekly", hour: 9, minute: 0, timezone: "UTC" }, /day of the week/],
    [{ cadence: "daily", dayOfWeek: 1, hour: 9, minute: 0, timezone: "UTC" }, /Only a weekly/],
    [{ cadence: "daily", hour: 9, minute: 0, timezone: "Mars/Olympus_Mons" }, /not a timezone/],
  ];

  for (const [schedule, pattern] of cases) {
    assert.match(scheduleProblem(schedule) ?? "", pattern, JSON.stringify(schedule));
    assert.throws(() => nextOccurrence(schedule, new Date()));
  }

  assert.equal(scheduleProblem({ cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: kolkata }), undefined);
});

test("a schedule reads back the way it was set", () => {
  assert.equal(
    describeSchedule({ cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: kolkata }),
    "Every Monday at 09:00 (Asia/Kolkata)",
  );
  assert.equal(describeSchedule({ cadence: "hourly", minute: 5, timezone: "UTC" }), "Every hour at 05 past (UTC)");
  assert.equal(describeSchedule({ cadence: "weekdays", hour: 7, minute: 30, timezone: "UTC" }), "Monday to Friday at 07:30 (UTC)");
});
