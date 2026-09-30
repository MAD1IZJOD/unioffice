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
 * Doors open onto the corridor that runs from it.
 *
 * Every row of desks has an aisle in front of it, and a narrow lane runs down
 * each side wall. Anything moving between two desks - a handoff, an
 * assignment - walks the floor, never the furniture: from the aisle in front
 * of one desk, along aisles and lanes to the door, down the corridor, and in
 * by the other door to the aisle in front of the other desk. A door opens onto
 * an aisle or the strip below the room's sign, never onto a desk.
 */

export const TILE = 8;

/** Desks per row inside a room. */
export const DESK_COLUMNS = 3;

/** One desk's footprint, in tiles: the agent, the desk and the name plate. */
const DESK_W = 5;
const DESK_H = 5;

/** The aisle in front of each row of desks, in tiles. */
const AISLE_H = 2;

/** One row of desks and the aisle in front of it. */
const ROW_H = DESK_H + AISLE_H;

/** The band at the top of a room that carries its sign. */
const HEADER_H = 3;
/** The side walls' lanes are the tile left clear either side of the desks. */
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
  /**
   * Where someone stands to hand them something: the aisle in front of their
   * desk. Every walk and route to or from the desk ends or starts here, in
   * open floor, never on the desk itself.
   */
  front: Point;
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
    HEADER_H + Math.max(1, ...row.map(rowsOf)) * ROW_H;

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
          y: (y + HEADER_H + row * ROW_H) * TILE,
          width: DESK_W * TILE,
          height: DESK_H * TILE,
        };

        return {
          agentId,
          roomId: room.id,
          seat,
          cell,
          at: { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 },
          front: { x: cell.x + cell.width / 2, y: cell.y + cell.height + (AISLE_H * TILE) / 2 },
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
 * It starts in the aisle in front of one desk and ends in the aisle in front
 * of the other, and walks only floor: aisles, the lanes down the side walls,
 * the strip below a room's sign, doorways and the corridor - never across a
 * desk or through a wall. Inside one room it follows the shared aisle, or a
 * side lane between rows. Every leg runs along one axis, and the same two
 * desks always give the same way. Undefined when either agent is not on the
 * plan, which is how something the caller cannot see stays unseen.
 */
export function pathBetween(plan: FloorPlan, fromAgentId: string, toAgentId: string): Point[] | undefined {
  const from = plan.seats.get(fromAgentId);
  const to = plan.seats.get(toAgentId);
  if (!from || !to) return undefined;

  const fromRoom = plan.rooms.find((room) => room.id === from.roomId)!;

  if (from.roomId === to.roomId) {
    if (from.front.y === to.front.y) return corners([from.front, to.front]);

    // Another row: along this aisle to the side lane, and along theirs.
    const lane = laneOf(fromRoom, from);
    return corners([from.front, { x: lane, y: from.front.y }, { x: lane, y: to.front.y }, to.front]);
  }

  const toRoom = plan.rooms.find((room) => room.id === to.roomId)!;
  const corridor = plan.corridor.y + plan.corridor.height / 2;

  return corners([
    ...toDoor(fromRoom, from),
    { x: fromRoom.door.x, y: corridor },
    { x: toRoom.door.x, y: corridor },
    ...toDoor(toRoom, to).reverse(),
  ]);
}

/**
 * From the aisle in front of a desk to its room's door.
 *
 * A north room's door opens onto the aisle of its last row, so that row goes
 * straight along it; any other row goes by a side lane first. A south room's
 * door opens onto the strip below its sign, so the way goes by a side lane
 * up past the desks, and along that strip to the door.
 */
function toDoor(room: PlacedRoom, seat: PlacedSeat): Point[] {
  const lane = laneOf(room, seat);

  if (room.side === "north") {
    const doorAisle = room.rect.y + room.rect.height - (AISLE_H * TILE) / 2;
    if (seat.front.y === doorAisle) return [seat.front, { x: room.door.x, y: doorAisle }, room.door];

    return [seat.front, { x: lane, y: seat.front.y }, { x: lane, y: doorAisle }, { x: room.door.x, y: doorAisle }, room.door];
  }

  // Below the sign and clear of the first row's desks.
  const strip = room.rect.y + HEADER_H * TILE - TILE / 2;
  return [seat.front, { x: lane, y: seat.front.y }, { x: lane, y: strip }, { x: room.door.x, y: strip }, room.door];
}

/**
 * The lane down the side wall nearer a desk - the left one for the middle
 * desk - in the tile left clear between the wall and the desks.
 */
function laneOf(room: PlacedRoom, seat: PlacedSeat): number {
  return seat.at.x <= room.door.x ? room.rect.x + TILE / 2 : room.rect.x + room.rect.width - TILE / 2;
}

/** The corners of a walk, with no point repeated. Doorways stay in, even mid-line. */
function corners(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
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
