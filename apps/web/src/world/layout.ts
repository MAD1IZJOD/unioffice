/**
 * The floor plan: where each room is, where each seat is, and how to get from
 * one desk to another without going through a wall.
 *
 * Pure and deterministic. The same rooms with the same people always produce
 * the same plan, so a reload, a reconnect or a second tab puts everyone back
 * exactly where they were - nothing here is random, and nothing depends on
 * the order the snapshot happened to list things in beyond the order the
 * server already fixed.
 *
 * Units are art pixels. One tile is TILE pixels; the page scales the whole
 * scene, so a sprite drawn at one unit per pixel stays crisp.
 *
 *   ┌──────┐┌────────┐┌────────┐┌────────┐
 *   │      ││  hall  ││ room   ││ room   │
 *   │      │└───▢────┘└───▢────┘└───▢────┘
 *   commons ══════════ corridor ══════════
 *   │      │┌───▢────┐┌───▢────┐┌───▢────┐
 *   │      ││ room   ││ room   ││ room   │
 *   └──────┘└────────┘└────────┘└────────┘
 *
 * The commons is the way in, with the live missions pinned to its board.
 * Doors open onto the corridor that runs from it. Anything moving between two desks - a
 * handoff, an assignment - goes desk, door, corridor, door, desk.
 */

export const TILE = 8;

/** Desks per row inside a room. */
export const DESK_COLUMNS = 3;

/** One desk's footprint, in tiles: the agent, the desk and the name plate. */
const DESK_W = 5;
const DESK_H = 5;

/** The band at the top of a room that carries its sign. */
const HEADER_H = 3;
const ROOM_W = 1 + DESK_COLUMNS * DESK_W + 1;
const GAP = 1;
const CORRIDOR_H = 4;
const COMMONS_W = 15;
const MARGIN = 2;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedSeat {
  agentId: string;
  roomId: string;
  seat: number;
  /** Where the agent sits: the middle of their desk cell. */
  at: Point;
  /** The desk cell, for hit areas and focus rings. */
  cell: Rect;
}

export interface PlacedRoom {
  id: string;
  rect: Rect;
  /** Which side of the corridor it is on, which decides where its door is. */
  side: "north" | "south";
  /** The doorway, on the wall that faces the corridor. */
  door: Point;
  seats: PlacedSeat[];
}

export interface FloorPlan {
  width: number;
  height: number;
  rooms: PlacedRoom[];
  corridor: Rect;
  commons: Rect;
  seats: Map<string, PlacedSeat>;
}

export interface RoomInput {
  id: string;
  agentIds: string[];
}

/**
 * Lays the rooms out in the order the server gave them: the first half along
 * the north side of the corridor, the rest along the south.
 */
export function planFloor(rooms: RoomInput[]): FloorPlan {
  const northCount = Math.ceil(rooms.length / 2);
  const north = rooms.slice(0, northCount);
  const south = rooms.slice(northCount);

  const rowsOf = (room: RoomInput) => Math.max(1, Math.ceil(room.agentIds.length / DESK_COLUMNS));
  const heightOf = (row: RoomInput[]) =>
    HEADER_H + Math.max(1, ...row.map(rowsOf)) * DESK_H + 1;

  const northH = heightOf(north);
  const southH = south.length > 0 ? heightOf(south) : 0;
  const columns = Math.max(north.length, south.length, 1);

  const corridorY = MARGIN + northH;
  const southY = corridorY + CORRIDOR_H;
  const corridorW = columns * ROOM_W + (columns - 1) * GAP;
  const roomsX = MARGIN + COMMONS_W + GAP;

  const placed: PlacedRoom[] = [];
  const seats = new Map<string, PlacedSeat>();

  const place = (row: RoomInput[], y: number, height: number, side: PlacedRoom["side"]) => {
    row.forEach((room, index) => {
      const x = roomsX + index * (ROOM_W + GAP);
      const rect = { x: x * TILE, y: y * TILE, width: ROOM_W * TILE, height: height * TILE };
      const door = {
        x: rect.x + rect.width / 2,
        y: side === "north" ? rect.y + rect.height : rect.y,
      };

      const roomSeats = room.agentIds.map((agentId, seat): PlacedSeat => {
        const column = seat % DESK_COLUMNS;
        const row = Math.floor(seat / DESK_COLUMNS);
        const cell = {
          x: (x + 1 + column * DESK_W) * TILE,
          y: (y + HEADER_H + row * DESK_H) * TILE,
          width: DESK_W * TILE,
          height: DESK_H * TILE,
        };

        return {
          agentId,
          roomId: room.id,
          seat,
          cell,
          at: { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 },
        };
      });

      for (const seat of roomSeats) seats.set(seat.agentId, seat);

      placed.push({ id: room.id, rect, side, door, seats: roomSeats });
    });
  };

  place(north, MARGIN, northH, "north");
  place(south, southY, southH || 0, "south");

  const commonsH = northH + CORRIDOR_H + southH;

  return {
    width: (roomsX + corridorW + MARGIN) * TILE,
    height: (MARGIN + commonsH + MARGIN) * TILE,
    rooms: placed,
    corridor: {
      x: (MARGIN + COMMONS_W) * TILE,
      y: corridorY * TILE,
      width: (corridorW + GAP) * TILE,
      height: CORRIDOR_H * TILE,
    },
    commons: {
      x: MARGIN * TILE,
      y: MARGIN * TILE,
      width: COMMONS_W * TILE,
      height: commonsH * TILE,
    },
    seats,
  };
}

/**
 * The way from one agent's desk to another's, as the corners of the walk.
 *
 * Inside one room it is a straight line between the two desks. Between rooms
 * it leaves by the door, follows the middle of the corridor and comes in by
 * the other door - never through a wall. Undefined when either agent is not
 * on the plan, which is how something the caller cannot see stays unseen.
 */
export function pathBetween(plan: FloorPlan, fromAgentId: string, toAgentId: string): Point[] | undefined {
  const from = plan.seats.get(fromAgentId);
  const to = plan.seats.get(toAgentId);
  if (!from || !to) return undefined;

  if (from.roomId === to.roomId) return [from.at, to.at];

  const fromRoom = plan.rooms.find((room) => room.id === from.roomId)!;
  const toRoom = plan.rooms.find((room) => room.id === to.roomId)!;
  const lane = plan.corridor.y + plan.corridor.height / 2;

  return [
    from.at,
    { x: fromRoom.door.x, y: from.at.y },
    fromRoom.door,
    { x: fromRoom.door.x, y: lane },
    { x: toRoom.door.x, y: lane },
    toRoom.door,
    { x: toRoom.door.x, y: to.at.y },
    to.at,
  ].filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y);
}

/** An SVG path through the points, for drawing a route or moving along it. */
export function pathData(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

/** How far a walk is, so a longer one can take proportionally longer. */
export function pathLength(points: Point[]): number {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1]!;
    const b = points[index]!;
    total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  }

  return total;
}
