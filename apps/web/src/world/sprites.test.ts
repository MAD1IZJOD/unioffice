import { describe, expect, it } from "vitest";

import { DISCIPLINE_ORDER } from "../lib/workforce";

import {
  castOf,
  deskItemRuns,
  figureRuns,
  FIGURE_HEIGHT,
  FIGURE_WIDTH,
  lookOf,
  OUTFIT,
  stableHash,
  STANDING_HEIGHT,
  walkingRuns,
} from "./sprites";

const cells = (runs: ReturnType<typeof figureRuns>) =>
  new Set(runs.flatMap((run) => Array.from({ length: run.width }, (_, offset) => `${run.x + offset},${run.y}`)));

describe("the cast", () => {
  it("draws the same agent the same way every time", () => {
    expect(figureRuns(lookOf("tony", "engineering"))).toEqual(figureRuns(lookOf("tony", "engineering")));
    expect(stableHash("tony")).toBe(stableHash("tony"));
  });

  it("keeps everyone inside one figure's frame", () => {
    for (const discipline of DISCIPLINE_ORDER) {
      for (const run of figureRuns(lookOf(`agent-${discipline}`, discipline))) {
        expect(run.x).toBeGreaterThanOrEqual(0);
        expect(run.x + run.width).toBeLessThanOrEqual(FIGURE_WIDTH);
        expect(run.y).toBeGreaterThanOrEqual(0);
        expect(run.y).toBeLessThan(FIGURE_HEIGHT);
      }
    }
  });

  it("gives every discipline the same silhouette and something of its own", () => {
    const shapes = DISCIPLINE_ORDER.map((discipline) => figureRuns({ hair: "#000", haircut: 0, discipline }));
    const shared = cells(figureRuns({ hair: "#000", haircut: 0, discipline: "general" }));

    // Every drawing contains the whole shared figure - headphones and a
    // headset may add a pixel beside the head, nothing takes the body away -
    // while what is worn and carried makes each discipline's its own.
    for (const runs of shapes) {
      const drawn = cells(runs);
      expect([...shared].filter((cell) => !drawn.has(cell))).toEqual([]);
    }
    expect(new Set(shapes.map((runs) => JSON.stringify(runs))).size).toBe(DISCIPLINE_ORDER.length);
    expect(new Set(DISCIPLINE_ORDER.map((discipline) => JSON.stringify(deskItemRuns({ hair: "#000", haircut: 0, discipline })))).size)
      .toBe(DISCIPLINE_ORDER.length);
  });

  it("dresses nobody in the colours that mean live work or a person needed", () => {
    for (const outfit of Object.values(OUTFIT)) {
      expect([outfit.shirt, outfit.shade, outfit.accent]).not.toContain("#3b82f6");
      expect([outfit.shirt, outfit.shade, outfit.accent]).not.toContain("#e5484d");
    }
  });

  it("stands up as the same person, with two strides that differ only below the waist", () => {
    const look = lookOf("dana", "engineering");
    const seated = cells(figureRuns(look));
    const strides = [walkingRuns(look, 0), walkingRuns(look, 1)];

    for (const runs of strides) {
      const drawn = cells(runs);
      expect([...seated].filter((cell) => !drawn.has(cell))).toEqual([]);

      for (const run of runs) {
        expect(run.x).toBeGreaterThanOrEqual(0);
        expect(run.x + run.width).toBeLessThanOrEqual(FIGURE_WIDTH);
        expect(run.y).toBeLessThan(STANDING_HEIGHT);
      }
    }

    const upper = (runs: ReturnType<typeof figureRuns>) => runs.filter((run) => run.y < FIGURE_HEIGHT);
    expect(upper(strides[0]!)).toEqual(upper(strides[1]!));
    expect(strides[0]).not.toEqual(strides[1]);
  });

  it("dresses a crowded room so no two roommates of one discipline look the same", () => {
    // Twenty engineers in one room: more than enough to collide on id alone.
    const engineers = Array.from({ length: 20 }, (_, seat) => ({
      id: `e32813a2-dda6-4a89-a756-c2991510c${String(600 + seat)}`,
      roomId: "engineering",
      seat,
      capabilities: ["coding"],
    }));
    const cast = castOf(engineers);
    const looks = engineers.map((agent) => cast.get(agent.id)!);

    expect(new Set(looks.map((look) => `${look.hair}/${look.haircut}`)).size).toBe(20);
    expect(looks.every((look) => look.discipline === "engineering")).toBe(true);
  });

  it("keeps an agent's own look when no roommate has it, and lets other rooms repeat it", () => {
    // Tony and Arjun draw the same from their ids alone.
    const tony = "e32813a2-dda6-4a89-a756-c2991510c502";
    const arjun = "e32813a2-dda6-4a89-a756-c2991510c528";
    expect(lookOf(tony, "engineering")).toEqual(lookOf(arjun, "engineering"));

    const together = castOf([
      { id: tony, roomId: "engineering", seat: 0, capabilities: ["coding"] },
      { id: arjun, roomId: "engineering", seat: 1, capabilities: ["coding"] },
    ]);
    expect(together.get(tony)).toEqual(lookOf(tony, "engineering"));
    expect(together.get(arjun)).not.toEqual(together.get(tony));

    const apart = castOf([
      { id: tony, roomId: "engineering", seat: 0, capabilities: ["coding"] },
      { id: arjun, roomId: "research", seat: 0, capabilities: ["coding"] },
    ]);
    expect(apart.get(tony)).toEqual(lookOf(tony, "engineering"));
    expect(apart.get(arjun)).toEqual(lookOf(arjun, "engineering"));
  });

  it("gives the first seat its own look, and the same office the same cast however it arrives", () => {
    const agents = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, seat) => ({ id, roomId: "product", seat, capabilities: ["writing"] }));
    const cast = castOf(agents);

    expect(cast.get("a")).toEqual(lookOf("a", "general"));
    expect(castOf([...agents].reverse())).toEqual(cast);
  });

  it("tells two agents of one discipline apart by more than their name", () => {
    const looks = ["tony", "dana", "ada", "linus", "grace", "ken"].map((id) => lookOf(id, "engineering"));

    expect(new Set(looks.map((look) => `${look.hair}/${look.haircut}`)).size).toBeGreaterThan(1);
  });
});
