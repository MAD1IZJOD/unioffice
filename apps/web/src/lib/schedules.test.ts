import { describe, expect, it } from "vitest";

import { formatWhen, runLinkOf, runTone, scheduleFrom, scheduleStanding } from "./schedules";

describe("reading continuous missions", () => {
  const now = Date.parse("2026-09-24T12:00:00.000Z");

  it("says a moment either side of now the way a person would", () => {
    expect(formatWhen("2026-09-24T12:40:00.000Z", now)).toBe("in 40 minutes");
    expect(formatWhen("2026-09-24T15:00:00.000Z", now)).toBe("in 3 hours");
    expect(formatWhen("2026-09-28T03:30:00.000Z", now)).toBe("in 4 days");
    expect(formatWhen("2026-09-24T11:00:00.000Z", now)).toBe("1 hour ago");
    expect(formatWhen("2026-09-24T12:00:10.000Z", now)).toBe("any moment now");
    expect(formatWhen(undefined, now)).toBe("—");
  });

  it("tells a schedule that stopped itself apart from one a person paused", () => {
    expect(scheduleStanding({ status: "active" })).toEqual({ label: "Running on schedule", tone: "live" });
    expect(scheduleStanding({ status: "paused", pauseReason: "person" })).toEqual({ label: "Paused", tone: "idle" });
    expect(scheduleStanding({ status: "paused", pauseReason: "repeated_failures" }).tone).toBe("error");
    expect(scheduleStanding({ status: "paused", pauseReason: "owner_access" }).label).toBe("Stopped itself");
  });

  it("colours a run by what it means for the reader", () => {
    expect(runTone("completed")).toBe("live");
    expect(runTone("waiting_for_approval")).toBe("warning");
    expect(runTone("blocked")).toBe("error");
    expect(runTone("cancelled")).toBe("idle");
  });

  it("sends only the fields a cadence uses", () => {
    const form = { dayOfWeek: 1, time: "09:30", minuteOfHour: 15, timezone: "Asia/Kolkata" };

    expect(scheduleFrom({ ...form, cadence: "weekly" })).toEqual({ cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 30, timezone: "Asia/Kolkata" });
    expect(scheduleFrom({ ...form, cadence: "daily" })).toEqual({ cadence: "daily", hour: 9, minute: 30, timezone: "Asia/Kolkata" });
    expect(scheduleFrom({ ...form, cadence: "hourly" })).toEqual({ cadence: "hourly", minute: 15, timezone: "Asia/Kolkata" });
  });

  it("reads the run a mission is only from the whole link", () => {
    expect(runLinkOf({ continuousMission: { id: "cm-1", name: "Pricing watch", sequence: 3 } })).toEqual({
      continuousMissionId: "cm-1",
      name: "Pricing watch",
      sequence: 3,
    });
    expect(runLinkOf({})).toBeUndefined();
    expect(runLinkOf({ continuousMission: { id: "cm-1", sequence: 3 } })).toBeUndefined();
    expect(runLinkOf({ continuousMission: { id: "cm-1", name: "x", sequence: 0 } })).toBeUndefined();
  });
});
