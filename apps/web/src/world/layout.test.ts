import { describe, expect, it } from "vitest";

import { pathBetween, pathLength, planFloor, TILE, type FloorPlan, type Point } from "./layout";

const rooms = [
  { id: "hall", agentIds: ["tyrion", "jamie", "peter", "mike"] },
  { id: "engineering", agentIds: ["dana", "tony"] },
  { id: "finance", agentIds: ["harvey"] },
  { id: "operations", agentIds: [] },
  { id: "research", agentIds: ["rhea"] },
];

function inside(point: Point, rect: { x: number; y: number; width: number; height: number }) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Whether a straight, axis-aligned leg stays inside one of the given areas. */
function legInside(a: Point, b: Point, areas: Array<{ x: number; y: number; width: number; height: number }>) {
  const steps = 16;

  for (let index = 0; index <= steps; index += 1) {
    const point = { x: a.x + ((b.x - a.x) * index) / steps, y: a.y + ((b.y - a.y) * index) / steps };
    if (!areas.some((area) => inside(point, area))) return false;
  }

  return true;
}

describe("the floor plan", () => {
  it("is the same plan every time for the same rooms", () => {
    expect(JSON.stringify([...planFloor(rooms).seats])).toBe(JSON.stringify([...planFloor(rooms).seats]));
  });

  it("puts the first half of the rooms north of the corridor and the rest south", () => {
    const plan = planFloor(rooms);

    expect(plan.rooms.map((room) => [room.id, room.side])).toEqual([
      ["hall", "north"],
      ["engineering", "north"],
      ["finance", "north"],
      ["operations", "south"],
      ["research", "south"],
    ]);
  });

  it("seats everyone, and nobody twice", () => {
    const plan = planFloor(rooms);

    expect([...plan.seats.keys()].sort()).toEqual(["dana", "harvey", "jamie", "mike", "peter", "rhea", "tony", "tyrion"]);
    const cells = new Set([...plan.seats.values()].map((seat) => `${seat.at.x},${seat.at.y}`));
    expect(cells.size).toBe(plan.seats.size);
  });

  it("keeps each desk inside its own room", () => {
    const plan = planFloor(rooms);

    for (const room of plan.rooms) {
      for (const seat of room.seats) {
        expect(inside({ x: seat.cell.x, y: seat.cell.y }, room.rect)).toBe(true);
        expect(inside({ x: seat.cell.x + seat.cell.width, y: seat.cell.y + seat.cell.height }, room.rect)).toBe(true);
      }
    }
  });

  it("gives an empty room a place on the plan and nobody in it", () => {
    const operations = planFloor(rooms).rooms.find((room) => room.id === "operations")!;

    expect(operations.seats).toEqual([]);
    expect(operations.rect.height).toBeGreaterThan(0);
  });

  it("grows a room downward when it needs a second row of desks", () => {
    const plan = planFloor(rooms);
    const hall = plan.rooms.find((room) => room.id === "hall")!;
    const fourth = hall.seats[3]!;

    expect(fourth.at.x).toBe(hall.seats[0]!.at.x);
    expect(fourth.at.y).toBeGreaterThan(hall.seats[0]!.at.y);
  });

  it("puts doors on the wall that faces the corridor", () => {
    const plan = planFloor(rooms);

    for (const room of plan.rooms) {
      const wall = room.side === "north" ? room.rect.y + room.rect.height : room.rect.y;
      expect(room.door.y).toBe(wall);
      expect(Math.abs(room.door.y - (room.side === "north" ? plan.corridor.y : plan.corridor.y + plan.corridor.height))).toBe(0);
    }
  });

  it("works with a single room", () => {
    const plan = planFloor([{ id: "hall", agentIds: ["tyrion"] }]);

    expect(plan.rooms).toHaveLength(1);
    expect(plan.width).toBeGreaterThan(0);
    expect(plan.height % TILE).toBe(0);
  });
});

describe("the way between two desks", () => {
  it("is a straight line inside one room", () => {
    const plan = planFloor(rooms);

    expect(pathBetween(plan, "dana", "tony")).toEqual([plan.seats.get("dana")!.at, plan.seats.get("tony")!.at]);
  });

  it("goes by the doors and the corridor between rooms, never through a wall", () => {
    const plan: FloorPlan = planFloor(rooms);
    const path = pathBetween(plan, "mike", "rhea")!;
    const from = plan.rooms.find((room) => room.id === "hall")!;
    const to = plan.rooms.find((room) => room.id === "research")!;

    expect(path[0]).toEqual(plan.seats.get("mike")!.at);
    expect(path.at(-1)).toEqual(plan.seats.get("rhea")!.at);
    expect(path).toContainEqual(from.door);
    expect(path).toContainEqual(to.door);

    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1]!;
      const b = path[index]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
      expect(legInside(a, b, [from.rect, to.rect, plan.corridor])).toBe(true);
    }
  });

  it("knows nothing about an agent that is not on the plan", () => {
    expect(pathBetween(planFloor(rooms), "mike", "someone-unseen")).toBeUndefined();
  });

  it("is longer between rooms than across one", () => {
    const plan = planFloor(rooms);

    expect(pathLength(pathBetween(plan, "mike", "rhea")!)).toBeGreaterThan(pathLength(pathBetween(plan, "dana", "tony")!));
  });
});
