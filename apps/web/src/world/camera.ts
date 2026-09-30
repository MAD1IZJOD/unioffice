import type { FloorPlan, Point } from "./layout";

/**
 * Where the camera goes to bring something into view.
 *
 * Pure: the same floor plan, stage and request always give the same view,
 * so bringing a room or an agent into view is a fact about the layout, not
 * something that drifts. The camera is `translate(x y) scale(k)` from floor
 * units to stage pixels.
 */

export interface Camera {
  x: number;
  y: number;
  k: number;
}

/**
 * Stage pixels at its right edge that the map is not drawn in: the rail the
 * zoom controls sit in, so they never cover a room's name or a desk. Every
 * view - the opening one, Fit, bringing something into view - is worked out
 * in the map's own width. Matches `--world-zoom-rail` in world.css.
 */
export const ZOOM_RAIL = 44;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What can be brought into view: one agent, one room, or several agents together. */
export type FocusTarget =
  | { kind: "agent"; id: string }
  | { kind: "room"; id: string }
  | { kind: "agents"; ids: string[] };

/** Floor units kept clear around a room or a group, so its edges are not flush with the stage's. */
const MARGIN = 24;

/** Closer than the whole office by at least this much when bringing one agent into view. */
const AGENT_ZOOM_OF_FIT = 1.6;

/**
 * The same view on a stage that changed size - the details panel opening
 * beside it, say: whatever was in the middle of the stage stays in the
 * middle, at the same zoom.
 */
export function keepCentre(
  camera: Camera,
  from: { width: number; height: number },
  to: { width: number; height: number },
): Camera {
  const centre = { x: (from.width / 2 - camera.x) / camera.k, y: (from.height / 2 - camera.y) / camera.k };
  return { k: camera.k, x: to.width / 2 - centre.x * camera.k, y: to.height / 2 - centre.y * camera.k };
}

/** The floor area a target covers, or nothing when none of it is on this floor. */
export function boxOf(plan: FloorPlan, target: FocusTarget): Box | undefined {
  if (target.kind === "room") {
    return plan.rooms.find((room) => room.id === target.id)?.rect;
  }

  const ids = target.kind === "agent" ? [target.id] : target.ids;
  const points = ids.map((id) => plan.seats.get(id)?.at).filter((point): point is Point => point !== undefined);
  if (points.length === 0) return undefined;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The camera that brings a target into view on a stage.
 *
 * One agent is centred, at least a little closer than the whole office and
 * never further out than the view already is. A room or a group is framed
 * whole, at a whole-number zoom where the pixel art stays crisp when it is
 * large enough for one - never further out than the whole office, never
 * closer than `maxZoom`.
 */
export function cameraOn(
  plan: FloorPlan,
  target: FocusTarget,
  stage: { width: number; height: number },
  options: { fit: number; current?: number; maxZoom: number },
): Camera | undefined {
  const box = boxOf(plan, target);
  if (!box || stage.width === 0 || stage.height === 0) return undefined;

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let k: number;

  if (target.kind === "agent") {
    k = Math.max(options.current ?? options.fit, options.fit * AGENT_ZOOM_OF_FIT);
  } else {
    const framed = Math.min(stage.width / (box.width + 2 * MARGIN), stage.height / (box.height + 2 * MARGIN));
    k = Math.min(options.maxZoom, Math.max(options.fit, framed >= 1 ? Math.floor(framed) : framed));
  }

  return { k, x: stage.width / 2 - centre.x * k, y: stage.height / 2 - centre.y * k };
}
