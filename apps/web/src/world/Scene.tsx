import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Maximize, Minus, Plus } from "lucide-react";

import type { WorldHandoff, WorldMission, WorldSnapshot } from "../lib/api";

import { HANDOFF_LABEL, missionStatusWord } from "./describe";
import { Desk } from "./Desk";
import { handoffKey } from "./moments";
import { pathBetween, pathData, pathLength, TILE, type FloorPlan, type Point } from "./layout";

/** What is selected on the map. */
export type WorldSelection =
  | { kind: "agent"; id: string }
  | { kind: "room"; id: string }
  | { kind: "handoff"; key: string }
  | { kind: "mission"; id: string };

/**
 * Something crossing the office once: a parcel for work changing hands, or
 * a slip for a step a plan gave out. Always the telling of a moment the page
 * saw happen; never ambient.
 */
export interface Travel {
  key: string;
  kind: "parcel" | "slip";
  points: Point[];
  /** Milliseconds before it sets off, so several slips leave one by one. */
  delay: number;
}

interface Camera {
  x: number;
  y: number;
  k: number;
}

const MIN_ZOOM_OF_FIT = 0.75;
const MAX_ZOOM = 7;

export function Scene({
  snapshot,
  plan,
  selection,
  onSelect,
  travels,
  onTravelled,
  focus,
}: {
  snapshot: WorldSnapshot;
  plan: FloorPlan;
  selection?: WorldSelection;
  onSelect: (selection: WorldSelection) => void;
  travels: Travel[];
  onTravelled: (key: string) => void;
  /** An agent to bring into view, and a nonce to do it again. */
  focus?: { agentId: string; nonce: number };
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<Camera>();
  const [fitted, setFitted] = useState("");

  // The stage's size, kept current. The camera is in screen pixels, so it
  // has to know how big the screen is.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;

    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useMemo<Camera | undefined>(() => {
    if (size.width === 0 || size.height === 0) return undefined;

    const k = Math.min(size.width / plan.width, size.height / plan.height);
    return { k, x: (size.width - plan.width * k) / 2, y: (size.height - plan.height * k) / 2 };
  }, [plan.height, plan.width, size.height, size.width]);

  // The first view: a whole-number zoom of two or more, so every art pixel
  // is a crisp block and a figure is big enough to read. If the office does
  // not fit at that size it opens at its top-left corner, to be panned; the
  // fit button shows all of it. Worked out again whenever the office changes
  // shape - a room added, a stage resized - but not on every refresh, which
  // would throw away where someone had panned to.
  const opening = useMemo<Camera | undefined>(() => {
    if (!fit) return undefined;

    // Three on a stage wide enough to show a few rooms at once, two on a
    // narrow one, and whatever whole number fits if the office fits larger.
    const k = Math.max(Math.floor(fit.k), size.width >= 960 ? 3 : 2);
    const width = plan.width * k;
    const height = plan.height * k;

    return {
      k,
      x: width <= size.width ? (size.width - width) / 2 : 0,
      y: height <= size.height ? (size.height - height) / 2 : 0,
    };
  }, [fit, plan.height, plan.width, size.height, size.width]);

  const shape = `${plan.width}x${plan.height}@${size.width}x${size.height}`;
  if (opening && fitted !== shape) {
    setFitted(shape);
    setCamera(opening);
  }

  const view = camera ?? opening;

  // The buttons and keys step between whole-number zooms, where pixel art
  // stays crisp; the wheel and a pinch zoom smoothly.
  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const base = camera ?? opening;
      if (!base || !fit) return;

      const whole = Math.round(base.k);
      const k = direction > 0 ? Math.min(MAX_ZOOM, Math.max(1, whole + 1)) : whole - 1 >= 1 ? whole - 1 : fit.k;
      const point = { x: size.width / 2, y: size.height / 2 };
      const ratio = k / base.k;

      setCamera({ k, x: point.x - (point.x - base.x) * ratio, y: point.y - (point.y - base.y) * ratio });
    },
    [camera, fit, opening, size.height, size.width],
  );

  const zoomAt = useCallback(
    (factor: number, at?: { x: number; y: number }) => {
      setCamera((current) => {
        const base = current ?? fit;
        if (!base || !fit) return current;

        const k = clamp(base.k * factor, fit.k * MIN_ZOOM_OF_FIT, MAX_ZOOM);
        const point = at ?? { x: size.width / 2, y: size.height / 2 };
        const ratio = k / base.k;

        return { k, x: point.x - (point.x - base.x) * ratio, y: point.y - (point.y - base.y) * ratio };
      });
    },
    [fit, size.height, size.width],
  );

  // Zooming with the wheel takes a held Ctrl or Cmd - which is also what a
  // trackpad pinch sends - so an ordinary scroll still scrolls the page past
  // the map. It needs a listener React does not attach as passive, or the
  // page would scroll underneath the zoom.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - box.left, y: event.clientY - box.top });
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Bringing an agent into view, once per request. Adjusted while
  // rendering, like the fit above, rather than from an effect.
  const [focused, setFocused] = useState<number>();
  const seatInFocus = focus ? plan.seats.get(focus.agentId) : undefined;

  if (focus && fit && seatInFocus && focus.nonce !== focused) {
    setFocused(focus.nonce);

    const k = Math.max(view?.k ?? fit.k, fit.k * 1.6);
    setCamera({ k, x: size.width / 2 - seatInFocus.at.x * k, y: size.height / 2 - seatInFocus.at.y * k });
  }

  /* Dragging and pinching ------------------------------------------------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);
  const pinch = useRef<number>(undefined);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragged.current = false;
    pinch.current = undefined;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const last = pointers.current.get(event.pointerId);
    if (!last) return;

    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const box = stage.current!.getBoundingClientRect();

      if (pinch.current) {
        zoomAt(distance / pinch.current, { x: (a!.x + b!.x) / 2 - box.left, y: (a!.y + b!.y) / 2 - box.top });
      }

      pinch.current = distance;
      dragged.current = true;
      return;
    }

    const dx = next.x - last.x;
    const dy = next.y - last.y;

    if (!dragged.current && Math.hypot(dx, dy) < 3) {
      pointers.current.set(event.pointerId, last);
      return;
    }

    if (!dragged.current) stage.current?.setPointerCapture(event.pointerId);
    dragged.current = true;
    setCamera((current) => (current ? { ...current, x: current.x + dx, y: current.y + dy } : current));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = undefined;
  };

  // A drag that ends over a desk is not a click on it.
  const onClickCapture = (event: React.MouseEvent) => {
    if (dragged.current) {
      event.stopPropagation();
      event.preventDefault();
      dragged.current = false;
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;

    const step = 48;
    const pan = (dx: number, dy: number) =>
      setCamera((current) => (current ? { ...current, x: current.x + dx, y: current.y + dy } : current));

    switch (event.key) {
      case "ArrowLeft": pan(step, 0); break;
      case "ArrowRight": pan(-step, 0); break;
      case "ArrowUp": pan(0, step); break;
      case "ArrowDown": pan(0, -step); break;
      case "+":
      case "=": zoomStep(1); break;
      case "-":
      case "_": zoomStep(-1); break;
      case "0": setCamera(fit); break;
      default: return;
    }

    event.preventDefault();
  };

  /* What is drawn --------------------------------------------------------- */
  const agentsById = useMemo(() => new Map(snapshot.agents.map((agent) => [agent.id, agent])), [snapshot.agents]);
  const roomsById = useMemo(() => new Map(snapshot.rooms.map((room) => [room.id, room])), [snapshot.rooms]);

  const open = snapshot.handoffs.filter((handoff) => handoff.state !== "delivered");

  return (
    <div
      ref={stage}
      className="world-stage"
      tabIndex={0}
      role="group"
      aria-label="Office map. Drag or use the arrow keys to move the view; plus and minus, or Ctrl and the wheel, zoom; zero fits the whole office. Tab moves between rooms and agents."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      <svg className="world-svg" width={size.width} height={size.height} aria-hidden={false}>
        <defs>
          <pattern id="world-floor" width={16} height={16} patternUnits="userSpaceOnUse">
            <rect width={16} height={16} className="world-floor-a" />
            <rect width={8} height={8} className="world-floor-b" />
            <rect x={8} y={8} width={8} height={8} className="world-floor-b" />
          </pattern>
          <pattern id="world-planks" width={24} height={8} patternUnits="userSpaceOnUse">
            <rect width={24} height={8} className="world-plank-a" />
            <rect y={7} width={24} height={1} className="world-plank-seam" />
            <rect x={11} width={1} height={7} className="world-plank-seam" />
          </pattern>
        </defs>

        {view && (
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <rect className="world-ground" x={0} y={0} width={plan.width} height={plan.height} />

            <rect className="world-corridor" {...plan.corridor} />

            <Commons
              rect={plan.commons}
              missions={snapshot.missions}
              selected={selection?.kind === "mission" ? selection.id : undefined}
              onSelect={(id) => onSelect({ kind: "mission", id })}
            />

            {plan.rooms.map((placed) => {
              const room = roomsById.get(placed.id);
              if (!room) return null;

              const selected = selection?.kind === "room" && selection.id === room.id;

              return (
                <g key={room.id} className={`world-room${selected ? " world-room-selected" : ""}`}>
                  <rect className="world-room-floor" {...placed.rect} />
                  <rect className="world-room-band" x={placed.rect.x} y={placed.rect.y} width={placed.rect.width} height={3 * TILE} />
                  <rect className="world-room-wall" {...placed.rect} />
                  <rect
                    className="world-door"
                    x={placed.door.x - 7}
                    y={placed.door.y - 1.5}
                    width={14}
                    height={3}
                  />

                  <g
                    className="world-room-sign"
                    role="button"
                    tabIndex={0}
                    aria-label={`${room.name}. ${room.agentIds.length === 0 ? "Nobody works here." : `${room.agentIds.length} ${room.agentIds.length === 1 ? "agent" : "agents"}.`}`}
                    aria-pressed={selected}
                    onClick={() => onSelect({ kind: "room", id: room.id })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect({ kind: "room", id: room.id });
                      }
                    }}
                  >
                    <rect className="world-hit" x={placed.rect.x} y={placed.rect.y} width={placed.rect.width} height={3 * TILE} />
                    <rect className="world-focus" x={placed.rect.x + 1} y={placed.rect.y + 1} width={placed.rect.width - 2} height={3 * TILE - 2} />
                    <text className="world-room-name" x={placed.rect.x + 8} y={placed.rect.y + 15}>
                      {clipText(room.name, 18)}
                    </text>
                    <text className="world-room-count" x={placed.rect.x + placed.rect.width - 8} y={placed.rect.y + 15} textAnchor="end">
                      {room.agentIds.length}
                    </text>
                  </g>

                  {room.agentIds.length === 0 && (
                    <text
                      className="world-room-empty"
                      x={placed.rect.x + placed.rect.width / 2}
                      y={placed.rect.y + 3 * TILE + 22}
                      textAnchor="middle"
                    >
                      Nobody works here
                    </text>
                  )}
                </g>
              );
            })}

            {open.map((handoff) => (
              <Route
                key={handoffKey(handoff)}
                handoff={handoff}
                points={pathBetween(plan, handoff.from.id, handoff.to.id)}
                selected={selection?.kind === "handoff" && selection.key === handoffKey(handoff)}
                onSelect={() => onSelect({ kind: "handoff", key: handoffKey(handoff) })}
              />
            ))}

            {plan.rooms.flatMap((placed) =>
              placed.seats.map((seat) => {
                const agent = agentsById.get(seat.agentId);
                if (!agent) return null;

                return (
                  <Desk
                    key={agent.id}
                    agent={agent}
                    seat={seat}
                    roomName={roomsById.get(placed.id)?.name}
                    selected={selection?.kind === "agent" && selection.id === agent.id}
                    onSelect={(id) => onSelect({ kind: "agent", id })}
                  />
                );
              }))}

            {travels.map((travel) => (
              <Traveller key={travel.key} travel={travel} onDone={onTravelled} />
            ))}
          </g>
        )}
      </svg>

      <div className="world-zoom" role="group" aria-label="Zoom">
        <button type="button" className="world-zoom-button" onClick={() => zoomStep(1)} aria-label="Zoom in">
          <Plus size={14} />
        </button>
        <button type="button" className="world-zoom-button" onClick={() => zoomStep(-1)} aria-label="Zoom out">
          <Minus size={14} />
        </button>
        <button type="button" className="world-zoom-button" onClick={() => setCamera(fit)} aria-label="Fit the whole office">
          <Maximize size={13} />
        </button>
      </div>
    </div>
  );
}

/**
 * The commons, where the corridor ends: the live missions pinned to a board.
 * A mission only appears here while it is under way and only if the viewer
 * may open it.
 */
function Commons({
  rect,
  missions,
  selected,
  onSelect,
}: {
  rect: { x: number; y: number; width: number; height: number };
  missions: WorldMission[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const cardHeight = 20;
  const room = Math.max(0, Math.floor((rect.height - 3 * TILE - 16) / (cardHeight + 4)));
  const shown = missions.slice(0, room);

  return (
    <g className="world-commons">
      <rect className="world-room-floor world-commons-floor" {...rect} />
      <rect className="world-room-band" x={rect.x} y={rect.y} width={rect.width} height={3 * TILE} />
      <rect className="world-room-wall" {...rect} />
      <text className="world-room-name" x={rect.x + 8} y={rect.y + 15}>
        MISSION BOARD
      </text>

      <rect className="world-board" x={rect.x + 6} y={rect.y + 3 * TILE + 4} width={rect.width - 12} height={rect.height - 3 * TILE - 10} />

      {shown.length === 0 && (
        <text className="world-room-empty" x={rect.x + rect.width / 2} y={rect.y + 3 * TILE + 26} textAnchor="middle">
          Nothing under way
        </text>
      )}

      {shown.map((mission, index) => {
        const x = rect.x + 10;
        const y = rect.y + 3 * TILE + 8 + index * (cardHeight + 4);
        const width = rect.width - 20;
        const done = mission.steps > 0 ? mission.completedSteps / mission.steps : 0;

        return (
          <g
            key={mission.id}
            className={`world-card world-card-${mission.status}${selected === mission.id ? " world-card-selected" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`${mission.name}. ${missionStatusWord(mission)}. ${mission.completedSteps} of ${mission.steps} steps done.`}
            aria-pressed={selected === mission.id}
            onClick={() => onSelect(mission.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(mission.id);
              }
            }}
          >
            <rect className="world-card-paper" x={x} y={y} width={width} height={cardHeight} />
            <rect className="world-card-pin" x={x + width / 2 - 1} y={y - 1} width={3} height={3} />
            <rect className="world-focus" x={x - 1.5} y={y - 1.5} width={width + 3} height={cardHeight + 3} />
            <text className="world-card-name" x={x + 4} y={y + 8}>
              {clipText(mission.name, 20)}
            </text>
            <rect className="world-card-track" x={x + 4} y={y + 13} width={width - 8} height={2} />
            <rect className="world-card-progress" x={x + 4} y={y + 13} width={(width - 8) * done} height={2} />
          </g>
        );
      })}

      {missions.length > shown.length && (
        <text className="world-room-count" x={rect.x + rect.width / 2} y={rect.y + rect.height - 8} textAnchor="middle">
          and {missions.length - shown.length} more
        </text>
      )}
    </g>
  );
}

/**
 * Work that has changed hands and is still in play: a dashed route from the
 * desk that finished a step to the desk using it. Drawn for as long as the
 * handoff is in hand, held or not yet picked up; gone once delivered.
 */
function Route({
  handoff,
  points,
  selected,
  onSelect,
}: {
  handoff: WorldHandoff;
  points?: Point[];
  selected: boolean;
  onSelect: () => void;
}) {
  if (!points) return null;

  const d = pathData(points);
  const end = points.at(-1)!;

  return (
    <g
      className={`world-route world-route-${handoff.state}${selected ? " world-route-selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Handoff in ${handoff.missionName}: ${handoff.from.name} to ${handoff.to.name}, step ${handoff.fromStep.number} to step ${handoff.toStep.number}. ${HANDOFF_LABEL[handoff.state]}.`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <path className="world-route-hit" d={d} />
      <path className="world-route-line" d={d} />
      {/* Set down on the front of the receiving desk, clear of the name. */}
      <g transform={`translate(${end.x - 7} ${end.y + 2})`}>
        <Parcel />
      </g>
    </g>
  );
}

function Parcel() {
  return (
    <g className="world-parcel-sprite">
      <rect x={0} y={1} width={8} height={6} className="world-parcel-box" />
      <rect x={0} y={1} width={8} height={1} className="world-parcel-lid" />
      <rect x={3} y={1} width={2} height={6} className="world-parcel-ribbon" />
      <rect x={-0.5} y={0.5} width={9} height={7} className="world-parcel-edge" />
    </g>
  );
}

function Slip() {
  return (
    <g className="world-slip-sprite">
      <rect x={0} y={0} width={6} height={8} className="world-slip-paper" />
      <rect x={1} y={2} width={4} height={1} className="world-slip-line" />
      <rect x={1} y={4} width={3} height={1} className="world-slip-line" />
    </g>
  );
}

/** Pixels per second a parcel travels at: brisk, but readable. */
const TRAVEL_SPEED = 140;

/**
 * Carries a parcel or a slip along its path once, then says it is done.
 *
 * Moved by writing a transform straight onto the element each frame rather
 * than through React state, so a parcel crossing the office costs nothing
 * but its own element. Timed by the clock, not by frames: a tab that was in
 * the background finishes the trip the moment it is looked at again instead
 * of replaying it late.
 */
function Traveller({ travel, onDone }: { travel: Travel; onDone: (key: string) => void }) {
  const element = useRef<SVGGElement>(null);

  useEffect(() => {
    const length = pathLength(travel.points);
    const duration = Math.max(700, (length / TRAVEL_SPEED) * 1000);
    const begin = performance.now() + travel.delay;
    let frame = 0;

    const place = (progress: number) => {
      const at = pointAlong(travel.points, length * progress);
      element.current?.setAttribute("transform", `translate(${at.x - 4} ${at.y - 4})`);
    };

    place(0);

    const tick = (now: number) => {
      const progress = (now - begin) / duration;

      if (progress >= 1) {
        onDone(travel.key);
        return;
      }

      if (progress >= 0) {
        element.current?.setAttribute("opacity", "1");
        place(progress);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onDone, travel]);

  return (
    <g ref={element} className={`world-traveller world-traveller-${travel.kind}`} opacity={0} aria-hidden="true">
      {travel.kind === "parcel" ? <Parcel /> : <Slip />}
    </g>
  );
}

function pointAlong(points: Point[], distance: number): Point {
  let left = distance;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const leg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

    if (left <= leg && leg > 0) {
      const t = left / leg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }

    left -= leg;
  }

  return points.at(-1)!;
}


function clipText(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
