import { describe, expect, it } from "vitest";

import type { WorldHandoff } from "../lib/api";

import { pathBetween, planFloor } from "./layout";
import type { WorldMoment } from "./moments";
import { finish, travelsOf, underway, walkersOf } from "./travels";

const plan = planFloor([
  { id: "hall", agentIds: ["tyrion"] },
  { id: "engineering", agentIds: ["dana", "tony"] },
  { id: "research", agentIds: ["mike"] },
]);

const handoff: WorldHandoff = {
  from: { id: "mike", name: "Mike" },
  to: { id: "dana", name: "Dana" },
  fromStep: { number: 1, title: "Research the options" },
  toStep: { number: 2, title: "Build the prototype" },
  state: "in_progress",
  sentence: "Mike finished “Research the options”. Dana is using it.",
  at: "2026-09-29T10:00:00.000Z",
  missionId: "launch",
  missionName: "Launch",
};

const everyOtherMoment: WorldMoment[] = [
  { kind: "started", key: "started:dana", agentId: "dana", missionId: "launch", taskTitle: "Build the prototype" },
  { kind: "waiting", key: "waiting:tony", agentId: "tony", missionId: "launch", taskTitle: "Ship it" },
  { kind: "finished", key: "finished:mike", agentId: "mike", outcome: "completed", missionId: "launch", missionName: "Launch", taskTitle: "Research the options" },
  { kind: "finished", key: "failed:tony", agentId: "tony", outcome: "failed", missionId: "launch", missionName: "Launch", taskTitle: "Ship it" },
  { kind: "planning", key: "planning:tyrion", agentId: "tyrion", missionId: "launch", missionName: "Launch" },
];

describe("what crosses the floor", () => {
  it("walks the agent who finished the step to the desk of the one who uses it", () => {
    const trips = travelsOf([{ kind: "handoff", key: "handoff:launch:1>2", handoff }], plan);

    expect(trips).toEqual([
      { key: "handoff:launch:1>2", kind: "walk", agentId: "mike", points: pathBetween(plan, "mike", "dana"), delay: 0 },
    ]);
    expect(walkersOf(trips)).toEqual(new Set(["mike"]));
  });

  it("goes out through the doors and along the corridor, never through a wall", () => {
    const [walk] = travelsOf([{ kind: "handoff", key: "h", handoff }], plan);
    const points = walk!.points;

    // Every leg is straight along one axis: desk to door, door to corridor,
    // along the corridor, and in again.
    for (let index = 1; index < points.length; index += 1) {
      const [a, b] = [points[index - 1]!, points[index]!];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
    expect(points[0]).toEqual(plan.seats.get("mike")!.front);
    expect(points.at(-1)).toEqual(plan.seats.get("dana")!.front);
  });

  it("moves nobody for anything but work changing hands", () => {
    expect(travelsOf(everyOtherMoment, plan)).toEqual([]);
  });

  it("sends slips, not people, when a plan gives out its steps", () => {
    const trips = travelsOf([
      { kind: "assigned", key: "assigned:launch", missionId: "launch", missionName: "Launch", fromAgentId: "tyrion", toAgentIds: ["dana", "mike"] },
    ], plan);

    expect(trips.map((trip) => [trip.kind, trip.delay])).toEqual([["slip", 0], ["slip", 220]]);
    expect(walkersOf(trips).size).toBe(0);
  });

  it("walks nobody the viewer cannot see, at either end", () => {
    const unseen = { ...handoff, from: { id: "someone-elsewhere", name: "Someone" } };
    expect(travelsOf([{ kind: "handoff", key: "h", handoff: unseen }], plan)).toEqual([]);
  });

  it("makes the same trips from the same moments, every time", () => {
    const moments: WorldMoment[] = [{ kind: "handoff", key: "h", handoff }, ...everyOtherMoment];
    expect(travelsOf(moments, plan)).toEqual(travelsOf(moments, plan));
  });

  it("walks one result at a time when a step fed several, and keeps the chair empty throughout", () => {
    const toTony = { ...handoff, to: { id: "tony", name: "Tony" }, toStep: { number: 3, title: "Write it up" } };
    const trips = travelsOf([
      { kind: "handoff", key: "h:1>2", handoff },
      { kind: "handoff", key: "h:1>3", handoff: toTony },
      { kind: "assigned", key: "a", missionId: "launch", missionName: "Launch", fromAgentId: "tyrion", toAgentIds: ["dana", "mike"] },
    ], plan);

    expect(underway(trips).map((trip) => trip.key)).toEqual(["h:1>2", "a:dana", "a:mike"]);
    expect(walkersOf(trips)).toEqual(new Set(["mike"]));

    // The first walk is done: the next one sets off, and Mike is still away.
    const rest = trips.filter((trip) => trip.key !== "h:1>2");
    expect(underway(rest).map((trip) => trip.key)).toEqual(["h:1>3", "a:dana", "a:mike"]);
    expect(walkersOf(rest)).toEqual(new Set(["mike"]));

    // Both walks are done: Mike is back at the desk.
    expect(walkersOf(rest.filter((trip) => trip.kind !== "walk")).size).toBe(0);
  });

  it("sends an agent's next walk off from where the last one ended, and touches nothing else", () => {
    const toTony = { ...handoff, to: { id: "tony", name: "Tony" }, toStep: { number: 3, title: "Write it up" } };
    const fromTony = { ...handoff, from: { id: "tony", name: "Tony" }, fromStep: { number: 4, title: "Test it" }, toStep: { number: 5, title: "Ship it" } };
    const trips = travelsOf([
      { kind: "handoff", key: "h:1>2", handoff },
      { kind: "assigned", key: "a", missionId: "launch", missionName: "Launch", fromAgentId: "tyrion", toAgentIds: ["dana"] },
      { kind: "handoff", key: "h:4>5", handoff: fromTony },
      { kind: "handoff", key: "h:1>3", handoff: toTony },
    ], plan);

    const left = finish(trips, "h:1>2", 5_000);

    expect(left.map((trip) => trip.key)).toEqual(["a:dana", "h:4>5", "h:1>3"]);
    expect(left[2]).toEqual({ ...trips[3], after: 5_000 });
    // Everything else is the very same trip, so nothing under way restarts.
    expect(left[0]).toBe(trips[1]);
    expect(left[1]).toBe(trips[2]);

    // A slip, or a walk with nobody queued behind it, is simply over.
    expect(finish(left, "a:dana", 6_000).map((trip) => trip.key)).toEqual(["h:4>5", "h:1>3"]);
    expect(finish([trips[2]!], "h:4>5", 6_000)).toEqual([]);
  });

  it("makes no trip at all when nothing happened", () => {
    expect(travelsOf([], plan)).toEqual([]);
  });
});
