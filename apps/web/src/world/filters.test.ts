import { describe, expect, it } from "vitest";

import type { WorldAgent, WorldSnapshot } from "../lib/api";

import { AGENT_FILTERS, filterCounts, keeps, matchesFilter, type AgentFilter } from "./filters";

const asOf = "2026-09-29T10:00:00.000Z";

function agent(id: string, overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id,
    name: id,
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: [],
    roomId: "hall",
    seat: 0,
    workingElsewhere: false,
    upcomingSteps: 0,
    planningElsewhere: false,
    ...overrides,
  };
}

const cast = [
  agent("dana", { presence: "working", current: { missionId: "m", missionName: "M", taskTitle: "Build", state: "working" } }),
  agent("tony", { presence: "working", workingElsewhere: true }),
  agent("harvey", { presence: "waiting" }),
  agent("tyrion", { type: "orchestrator", planning: { missionId: "m", missionName: "M" } }),
  agent("mike"),
  agent("rhea", { status: "paused", presence: "paused" }),
  agent("peter", { status: "disabled", presence: "unavailable" }),
  agent("jamie", {
    lastOutcome: { missionId: "m", missionName: "M", taskTitle: "Send it", outcome: "failed", at: "2026-09-29T09:00:00.000Z" },
  }),
];

const kept = (...filters: AgentFilter[]) =>
  cast.filter((entry) => keeps(entry, new Set(filters), asOf)).map((entry) => entry.id);

describe("filtering the office by what agents are doing", () => {
  it("keeps each agent under the state the server recorded for them", () => {
    expect(kept("working")).toEqual(["dana", "tony"]);
    expect(kept("waiting")).toEqual(["harvey"]);
    expect(kept("planning")).toEqual(["tyrion"]);
    expect(kept("available")).toEqual(["mike", "jamie"]);
    expect(kept("off")).toEqual(["rhea", "peter"]);
    expect(kept("failed")).toEqual(["jamie"]);
  });

  it("keeps an agent in any of several filters, once", () => {
    expect(kept("working", "waiting")).toEqual(["dana", "tony", "harvey"]);
    expect(kept("available", "failed")).toEqual(["mike", "jamie"]);
  });

  it("keeps everyone when no filter is picked", () => {
    expect(kept()).toEqual(cast.map((entry) => entry.id));
  });

  it("keeps nobody for a filter it does not know, rather than guessing", () => {
    const unknown = "blocked" as AgentFilter;

    expect(cast.some((entry) => matchesFilter(entry, unknown, asOf))).toBe(false);
    expect(kept(unknown)).toEqual([]);
  });

  it("keeps nobody when nobody is in that state", () => {
    const quiet = cast.filter((entry) => entry.presence !== "waiting");
    expect(quiet.filter((entry) => keeps(entry, new Set(["waiting"]), asOf))).toEqual([]);
  });

  it("forgets a failure after a day, by the snapshot's own clock", () => {
    const old = agent("old", {
      lastOutcome: { missionId: "m", missionName: "M", taskTitle: "Send it", outcome: "failed", at: "2026-09-27T09:00:00.000Z" },
    });

    expect(matchesFilter(old, "failed", asOf)).toBe(false);
  });

  it("offers no filter for a state nothing records", () => {
    expect(AGENT_FILTERS.map((filter) => filter.id)).not.toContain("blocked");
  });

  it("names each state in the workforce's own words", () => {
    expect(AGENT_FILTERS.map((filter) => filter.label)).toEqual([
      "Working",
      "Waiting on a decision",
      "Writing a plan",
      "Available",
      "Paused or unavailable",
      "Last step failed",
    ]);
  });

  it("counts from the snapshot, so the numbers are the map's", () => {
    const snapshot = { generatedAt: asOf, agents: cast } as WorldSnapshot;

    expect(filterCounts(snapshot)).toEqual({ working: 2, waiting: 1, planning: 1, available: 2, off: 2, failed: 1 });
  });
});
