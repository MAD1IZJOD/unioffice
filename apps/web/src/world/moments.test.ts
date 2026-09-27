import { describe, expect, it } from "vitest";

import type { WorldAgent, WorldHandoff, WorldSnapshot } from "../lib/api";

import { CONTINUITY_MS, continuous, momentsBetween, type Reading } from "./moments";

function agent(id: string, overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
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

function handoff(overrides: Partial<WorldHandoff> = {}): WorldHandoff {
  return {
    from: { id: "mike", name: "Mike" },
    to: { id: "tony", name: "Tony" },
    fromStep: { number: 1, title: "Research it" },
    toStep: { number: 2, title: "Build it" },
    state: "in_progress",
    sentence: "Mike finished “Research it”. Tony is working from it now.",
    at: "2026-09-27T10:00:00.000Z",
    missionId: "launch",
    missionName: "Launch",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    organizationId: "org",
    generatedAt: "2026-09-27T10:00:00.000Z",
    rooms: [],
    agents: [agent("tyrion", { type: "orchestrator" }), agent("mike"), agent("tony")],
    missions: [],
    handoffs: [],
    ...overrides,
  };
}

let clock = 1_000_000;

function reading(value: WorldSnapshot, overrides: Partial<Reading> = {}): Reading {
  clock += 5_000;
  return { snapshot: value, receivedAt: clock, live: true, connection: 1, ...overrides };
}

describe("when a change may be shown as movement", () => {
  it("never on the first reading", () => {
    expect(momentsBetween(undefined, reading(snapshot({ handoffs: [handoff()] })))).toEqual([]);
  });

  it("only between two readings of one unbroken connection", () => {
    const first = reading(snapshot());
    const next = reading(snapshot({ handoffs: [handoff()] }));

    expect(continuous(first, next)).toBe(true);
    expect(continuous(first, { ...next, connection: 2 })).toBe(false);
    expect(continuous({ ...first, live: false }, next)).toBe(false);
    expect(continuous(first, { ...next, live: false })).toBe(false);
  });

  it("not across a gap longer than a connected page ever leaves", () => {
    const first = reading(snapshot());
    const late = { ...reading(snapshot({ handoffs: [handoff()] })), receivedAt: first.receivedAt + CONTINUITY_MS + 1 };

    expect(momentsBetween(first, late)).toEqual([]);
  });

  it("not across organizations", () => {
    const first = reading(snapshot());
    const other = reading(snapshot({ organizationId: "another", handoffs: [handoff()] }));

    expect(momentsBetween(first, other)).toEqual([]);
  });

  it("and a reconnect replays nothing that happened while it was away", () => {
    const before = reading(snapshot());
    const afterReconnect = reading(
      snapshot({ handoffs: [handoff()], agents: [agent("tyrion", { type: "orchestrator" }), agent("mike"), agent("tony", { presence: "working" })] }),
      { connection: 2 },
    );

    expect(momentsBetween(before, afterReconnect)).toEqual([]);
  });
});

describe("what changed", () => {
  it("a handoff that appears is told once, with its mission", () => {
    const first = reading(snapshot());
    const second = reading(snapshot({ handoffs: [handoff()] }));
    const third = reading(snapshot({ handoffs: [handoff({ state: "delivered" })] }));

    const moments = momentsBetween(first, second);
    expect(moments).toHaveLength(1);
    expect(moments[0]).toMatchObject({ kind: "handoff", handoff: { missionId: "launch", from: { id: "mike" }, to: { id: "tony" } } });

    expect(momentsBetween(second, third).filter((moment) => moment.kind === "handoff")).toEqual([]);
  });

  it("a plan handing out its steps comes from the planner to whoever holds them", () => {
    const planning = reading(snapshot({
      agents: [agent("tyrion", { type: "orchestrator", planning: { missionId: "launch", missionName: "Launch" } }), agent("mike"), agent("tony")],
      missions: [{ id: "launch", name: "Launch", status: "planning", agentIds: [], steps: 0, completedSteps: 0 }],
    }));
    const planned = reading(snapshot({
      missions: [{ id: "launch", name: "Launch", status: "queued", agentIds: ["mike", "tony"], steps: 2, completedSteps: 0 }],
    }));

    const moments = momentsBetween(planning, planned);
    expect(moments).toContainEqual(expect.objectContaining({
      kind: "assigned",
      missionId: "launch",
      fromAgentId: "tyrion",
      toAgentIds: ["mike", "tony"],
    }));
  });

  it("a mission that simply appears, already planned, is not dressed up as an assignment", () => {
    const moments = momentsBetween(
      reading(snapshot()),
      reading(snapshot({ missions: [{ id: "old", name: "Old", status: "executing", agentIds: ["tony"], steps: 2, completedSteps: 1 }] })),
    );

    expect(moments.filter((moment) => moment.kind === "assigned")).toEqual([]);
  });

  it("an agent taking up a step, being held for a decision and finishing are each told", () => {
    const current = { missionId: "launch", missionName: "Launch", taskTitle: "Build it", state: "working" as const };
    const idle = reading(snapshot());
    const working = reading(snapshot({ agents: [agent("tyrion", { type: "orchestrator" }), agent("mike"), agent("tony", { presence: "working", current })] }));
    const waiting = reading(snapshot({
      agents: [agent("tyrion", { type: "orchestrator" }), agent("mike"), agent("tony", { presence: "waiting", current: { ...current, state: "waiting" } })],
    }));
    const done = reading(snapshot({
      agents: [
        agent("tyrion", { type: "orchestrator" }),
        agent("mike"),
        agent("tony", { lastOutcome: { missionId: "launch", missionName: "Launch", taskTitle: "Build it", outcome: "completed", at: "2026-09-27T10:05:00.000Z" } }),
      ],
    }));

    expect(momentsBetween(idle, working).map((moment) => moment.kind)).toEqual(["started"]);
    expect(momentsBetween(working, waiting).map((moment) => moment.kind)).toEqual(["waiting"]);
    expect(momentsBetween(waiting, done).map((moment) => moment.kind)).toEqual(["finished"]);
  });

  it("nothing changing is nothing to tell", () => {
    const same = snapshot({ handoffs: [handoff()] });

    expect(momentsBetween(reading(same), reading(same))).toEqual([]);
  });
});
