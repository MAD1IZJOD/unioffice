import { describe, expect, it } from "vitest";

import { DISCIPLINE_ORDER } from "../lib/workforce";

import { deskItemRuns, figureRuns, FIGURE_HEIGHT, FIGURE_WIDTH, lookOf, OUTFIT, stableHash } from "./sprites";

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

  it("tells two agents of one discipline apart by more than their name", () => {
    const looks = ["tony", "dana", "ada", "linus", "grace", "ken"].map((id) => lookOf(id, "engineering"));

    expect(new Set(looks.map((look) => `${look.hair}/${look.haircut}`)).size).toBeGreaterThan(1);
  });
});
