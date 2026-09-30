import { describe, expect, it } from "vitest";

import { boxOf, cameraOn, keepCentre, type Camera } from "./camera";
import { planFloor } from "./layout";

const plan = planFloor([
  { id: "hall", agentIds: ["tyrion", "jamie", "peter"] },
  { id: "engineering", agentIds: ["dana", "tony"] },
  { id: "finance", agentIds: ["harvey"] },
  { id: "research", agentIds: ["mike"] },
]);

const stage = { width: 1200, height: 800 };
const fit = Math.min(stage.width / plan.width, stage.height / plan.height);
const options = { fit, maxZoom: 7 };

/** Where a floor point lands on the stage under a camera. */
const onStage = (camera: Camera, point: { x: number; y: number }) => ({
  x: camera.x + point.x * camera.k,
  y: camera.y + point.y * camera.k,
});

describe("bringing something into view", () => {
  it("centres one agent, closer than the whole office", () => {
    const camera = cameraOn(plan, { kind: "agent", id: "harvey" }, stage, options)!;

    expect(onStage(camera, plan.seats.get("harvey")!.at)).toEqual({ x: 600, y: 400 });
    expect(camera.k).toBeCloseTo(fit * 1.6);
  });

  it("never pulls back from an agent someone had already zoomed in on", () => {
    const camera = cameraOn(plan, { kind: "agent", id: "harvey" }, stage, { ...options, current: 6 })!;
    expect(camera.k).toBe(6);
  });

  it("frames a whole room at a crisp zoom, centred", () => {
    const camera = cameraOn(plan, { kind: "room", id: "engineering" }, stage, options)!;
    const room = plan.rooms.find((entry) => entry.id === "engineering")!.rect;

    const topLeft = onStage(camera, room);
    const bottomRight = onStage(camera, { x: room.x + room.width, y: room.y + room.height });

    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(stage.width);
    expect(bottomRight.y).toBeLessThanOrEqual(stage.height);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(600);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(400);
    expect(Number.isInteger(camera.k)).toBe(true);
    expect(camera.k).toBeGreaterThanOrEqual(fit);
  });

  it("stops at the closest zoom, however small the room is on however large a stage", () => {
    const huge = { width: 20_000, height: 20_000 };
    const k = Math.min(huge.width / plan.width, huge.height / plan.height);

    expect(cameraOn(plan, { kind: "room", id: "research" }, huge, { fit: Math.min(k, 7), maxZoom: 7 })!.k).toBe(7);
  });

  it("frames several agents together, every one of them on the stage", () => {
    const ids = ["tyrion", "dana", "harvey"];
    const camera = cameraOn(plan, { kind: "agents", ids }, stage, options)!;

    for (const id of ids) {
      const at = onStage(camera, plan.seats.get(id)!.at);
      expect(at.x).toBeGreaterThanOrEqual(0);
      expect(at.x).toBeLessThanOrEqual(stage.width);
      expect(at.y).toBeGreaterThanOrEqual(0);
      expect(at.y).toBeLessThanOrEqual(stage.height);
    }
  });

  it("ignores anyone not on this floor, and goes nowhere when nobody is", () => {
    expect(boxOf(plan, { kind: "agents", ids: ["dana", "someone-elsewhere"] })).toEqual(boxOf(plan, { kind: "agent", id: "dana" }));
    expect(cameraOn(plan, { kind: "agents", ids: ["someone-elsewhere"] }, stage, options)).toBeUndefined();
    expect(cameraOn(plan, { kind: "agent", id: "someone-elsewhere" }, stage, options)).toBeUndefined();
    expect(cameraOn(plan, { kind: "room", id: "a-room-you-cannot-see" }, stage, options)).toBeUndefined();
  });

  it("goes nowhere until the stage has a size", () => {
    expect(cameraOn(plan, { kind: "room", id: "hall" }, { width: 0, height: 0 }, options)).toBeUndefined();
  });

  it("keeps whatever was in the middle in the middle when the stage changes size", () => {
    const camera = { x: -300, y: -120, k: 3 };
    const wide = { width: 992, height: 520 };
    const narrow = { width: 636, height: 520 };
    const middle = { x: (496 + 300) / 3, y: (260 + 120) / 3 };

    const kept = keepCentre(camera, wide, narrow);
    expect(kept.k).toBe(3);
    expect(onStage(kept, middle).x).toBeCloseTo(318);
    expect(onStage(kept, middle).y).toBeCloseTo(260);
  });

  describe("with all twenty in the office", () => {
    const office = planFloor([
      { id: "hall", agentIds: ["tyrion", "jamie", "peter"] },
      { id: "customer-success", agentIds: ["rhea", "katrina"] },
      { id: "engineering", agentIds: ["dana", "tony", "wanda", "bruce", "natasha", "sam"] },
      { id: "finance", agentIds: ["harvey"] },
      { id: "operations", agentIds: ["brienne", "davos"] },
      { id: "product", agentIds: ["jessica"] },
      { id: "research", agentIds: ["mike", "rachel"] },
      { id: "revenue-growth", agentIds: ["donna", "louis", "sansa"] },
    ]);

    // A desktop map, and a phone's once the zoom rail is taken off.
    for (const [label, area] of [["desktop", { width: 948, height: 437 }], ["phone", { width: 310, height: 353 }]] as const) {
      const fitK = Math.min(area.width / office.width, area.height / office.height);
      const opts = { fit: fitK, maxZoom: 7 };

      it(`fits the whole office on a ${label} map`, () => {
        const fit = { k: fitK, x: (area.width - office.width * fitK) / 2, y: (area.height - office.height * fitK) / 2 };
        const topLeft = onStage(fit, { x: 0, y: 0 });
        const bottomRight = onStage(fit, { x: office.width, y: office.height });

        expect(topLeft.x).toBeGreaterThanOrEqual(-0.001);
        expect(topLeft.y).toBeGreaterThanOrEqual(-0.001);
        expect(bottomRight.x).toBeLessThanOrEqual(area.width + 0.001);
        expect(bottomRight.y).toBeLessThanOrEqual(area.height + 0.001);
      });

      it(`brings every one of the twenty into the middle of a ${label} map`, () => {
        for (const [id, seat] of office.seats) {
          const camera = cameraOn(office, { kind: "agent", id }, area, opts);
          expect(camera, id).toBeDefined();
          const at = onStage(camera!, seat.at);
          expect(at.x, id).toBeCloseTo(area.width / 2);
          expect(at.y, id).toBeCloseTo(area.height / 2);
        }
      });

      it(`frames every room whole on a ${label} map`, () => {
        for (const room of office.rooms) {
          const camera = cameraOn(office, { kind: "room", id: room.id }, area, opts)!;
          const topLeft = onStage(camera, room.rect);
          const bottomRight = onStage(camera, { x: room.rect.x + room.rect.width, y: room.rect.y + room.rect.height });
          const fitsWhole = topLeft.x >= -0.001 && topLeft.y >= -0.001 && bottomRight.x <= area.width + 0.001 && bottomRight.y <= area.height + 0.001;
          // A room larger than the map even at the whole-office zoom cannot be whole; none is.
          expect(fitsWhole, room.id).toBe(true);
        }
      });
    }

    it("still opens the desktop map at a readable, whole-number zoom, not shrunk to fit", () => {
      const area = { width: 948, height: 437 };
      const fitK = Math.min(area.width / office.width, area.height / office.height);
      const opening = Math.max(Math.floor(fitK), area.width >= 960 ? 3 : 2);

      expect(Number.isInteger(opening)).toBe(true);
      expect(opening).toBeGreaterThanOrEqual(2);
      expect(opening).toBeGreaterThan(fitK);
    });
  });

  it("gives the same view for the same request, every time", () => {
    expect(cameraOn(plan, { kind: "room", id: "finance" }, stage, options)).toEqual(
      cameraOn(plan, { kind: "room", id: "finance" }, stage, options));
  });
});
