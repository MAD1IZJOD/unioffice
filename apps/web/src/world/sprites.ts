import { disciplineOf, type Discipline } from "../lib/workforce";

/**
 * The people in the world, drawn from pixel maps in code.
 *
 * Every agent is the same small figure - one head, one body, one scale, one
 * way of moving - so the office reads as one cast rather than a sticker
 * sheet. What tells them apart is what they carry and wear, and that is
 * decided by their discipline, which is itself derived from the capabilities
 * the server granted them: an engineer wears headphones because it holds
 * the engineering capabilities, not because of its name. Only the hair is
 * chosen per agent, from a stable hash of its id, so two engineers are two
 * people and the same engineer is always the same person.
 *
 * The heads are a pale clay rather than any human skin tone. These are
 * agents, and the figure should say so.
 */

/** A horizontal run of one colour: the unit the scene draws. */
export interface PixelRun {
  x: number;
  y: number;
  width: number;
  fill: string;
}

export const FIGURE_WIDTH = 12;
export const FIGURE_HEIGHT = 13;

const INK = "#161920";
const HEAD = "#d7d0e6";
const HEAD_SHADE = "#b6adcb";
const MOUTH = "#7c6a8e";
const LIGHT = "#e9ecf2";
const DARK = "#2a2f3a";
const METAL = "#99a3b4";

const HAIR = ["#2b2f3a", "#6b4f3a", "#c9a76b", "#9aa5b8", "#5c4160", "#3d5a6b", "#8a8f99"] as const;

/**
 * Clothing, per discipline. Muted on purpose: blue and red mean something in
 * this product - live work, and a person being needed - so no one is dressed
 * in either.
 */
export const OUTFIT: Record<Discipline, { shirt: string; shade: string; accent: string }> = {
  orchestration: { shirt: "#3a4150", shade: "#2c323e", accent: "#b7a36a" },
  engineering: { shirt: "#4d6479", shade: "#3c4f60", accent: "#c9d2dc" },
  quantitative: { shirt: "#4f6f60", shade: "#3e584c", accent: "#d9d3b0" },
  research: { shirt: "#6e5f86", shade: "#584b6c", accent: "#d8cfe8" },
  operations: { shirt: "#8a6a4d", shade: "#6f543c", accent: "#e2c9a4" },
  communication: { shirt: "#7d5763", shade: "#65454f", accent: "#e6c6cf" },
  general: { shirt: "#5d6572", shade: "#4a515c", accent: "#cfd5de" },
};

/**
 * The shared figure. Keys: o outline, h hair, s head, S head shade, e eye,
 * m mouth, b shirt, B shirt shade. A dot is nothing.
 */
const BASE = [
  "...oooooo...",
  "..ohhhhhho..",
  ".ohhhhhhhho.",
  ".ohssssssho.",
  ".o" + "s".repeat(8) + "o.",
  ".osesssseso.",
  ".osssmmssso.",
  "..oSSSSSSo..",
  "...obbbbo...",
  "..obbbbbbo..",
  ".obbbbbbbbo.",
  ".obBbbbbBbo.",
  ".obBbbbbBbo.",
];

/** Three haircuts. Replace the top rows of the figure. */
const HAIRCUTS: Array<Record<number, string>> = [
  {},
  { 0: "....oooo....", 1: "..oohhhhoo.." },
  { 3: ".ohhhhssssho." },
];

type Overlay = Array<[x: number, y: number, key: string]>;

/** What each discipline wears or carries on the figure itself. */
const WEARS: Record<Discipline, Overlay> = {
  // A tie and a lapel pin: the one who holds the plan together.
  orchestration: [[5, 8, "r"], [6, 8, "r"], [5, 9, "r"], [6, 9, "r"], [5, 10, "r"], [6, 10, "r"], [3, 10, "w"]],
  // Headphones: a band over the head and a cup on each ear.
  engineering: [[3, 0, "k"], [8, 0, "k"], [2, 1, "k"], [9, 1, "k"], [0, 4, "k"], [0, 5, "k"], [11, 4, "k"], [11, 5, "k"], [1, 4, "a"], [10, 4, "a"]],
  // Square glasses.
  quantitative: [[2, 5, "k"], [4, 5, "k"], [5, 5, "k"], [6, 5, "k"], [7, 5, "k"], [9, 5, "k"], [2, 4, "k"], [4, 4, "k"], [7, 4, "k"], [9, 4, "k"]],
  // Round glasses and a pencil behind the ear.
  research: [[2, 5, "a"], [4, 5, "a"], [5, 5, "a"], [6, 5, "a"], [7, 5, "a"], [9, 5, "a"], [11, 3, "r"], [11, 2, "r"]],
  // A lanyard and badge.
  operations: [[4, 9, "r"], [7, 9, "r"], [5, 10, "w"], [6, 10, "w"], [5, 11, "w"], [6, 11, "w"]],
  // A headset: one cup, a band, and a mic to the mouth.
  communication: [[3, 0, "k"], [8, 0, "k"], [0, 4, "k"], [0, 5, "k"], [1, 6, "k"], [2, 7, "k"], [3, 7, "k"], [4, 7, "r"]],
  // A plain badge.
  general: [[7, 10, "w"], [8, 10, "w"]],
};

/**
 * What sits on their desk, drawn in a 10 x 8 box on the desk top. The
 * engineer's wrench, the quantitative specialist's calculator, the
 * researcher's notebook, the operations lead's clipboard, the communicator's
 * phone, and the planner's board of pinned steps.
 */
const DESK_ITEMS: Record<Discipline, string[]> = {
  orchestration: [
    "oooooooo..",
    "owwwwwwo..",
    "owrrwwwo..",
    "owwwrrwo..",
    "owrwwwwo..",
    "oooooooo..",
    "...oo.....",
    "..oooo....",
  ],
  engineering: [
    "..........",
    ".aa.......",
    "aoaa......",
    ".aaaa.....",
    "...aaa....",
    "....aaa...",
    ".....aaoa.",
    "......aa..",
  ],
  quantitative: [
    ".oooooo...",
    ".okkkko...",
    ".oaaaao...",
    ".owawao...",
    ".oawawo...",
    ".owawao...",
    ".oooooo...",
    "..........",
  ],
  research: [
    "..........",
    "ooooooooo.",
    "owwwowwwo.",
    "owkkowwwo.",
    "owwwowkko.",
    "owkkowwwo.",
    "ooooooooo.",
    "..........",
  ],
  operations: [
    "...oo.....",
    ".oaaaao...",
    ".owwwwo...",
    ".owkkwo...",
    ".owwwwo...",
    ".owkkwo...",
    ".owwwwo...",
    ".oooooo...",
  ],
  communication: [
    "..........",
    "..oooo....",
    "..okko....",
    "..owwo....",
    "..owwo....",
    "..okko....",
    "..oooo....",
    "..........",
  ],
  general: [
    "..........",
    "..........",
    "..oooooo..",
    "..owwwwo..",
    "..owwwwo..",
    "..oooooo..",
    "..........",
    "..........",
  ],
};

/** A stable number from a string, the same in every browser and every load. */
export function stableHash(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export interface Look {
  hair: string;
  haircut: number;
  discipline: Discipline;
}

/** How one agent looks: their discipline's outfit and their own hair. */
export function lookOf(agentId: string, discipline: Discipline): Look {
  const hash = stableHash(agentId);

  return {
    hair: HAIR[hash % HAIR.length]!,
    haircut: Math.floor(hash / HAIR.length) % HAIRCUTS.length,
    discipline,
  };
}

/** Every hair and haircut there is, in a fixed order. */
const COMBINATIONS = HAIR.length * HAIRCUTS.length;

/**
 * How everyone in the office looks, told apart from their roommates.
 *
 * An agent's own look comes from its id, as `lookOf` gives it. With a
 * handful of people in a room that is enough; with twenty engineers in one,
 * two of them drawing the same would be a person the viewer cannot pick out.
 * So a room is dressed in seat order, and anyone whose look a roommate of
 * the same discipline already has takes the next free hair and haircut
 * instead. Nothing is random: the same office always looks the same, and an
 * agent whose look nobody shares keeps its own.
 */
export function castOf(
  agents: ReadonlyArray<{ id: string; roomId: string; seat: number; type?: string; capabilities?: string[] }>,
): Map<string, Look> {
  const looks = new Map<string, Look>();
  const takenByRoom = new Map<string, Set<string>>();
  const keyOf = (look: Look) => `${look.discipline}/${look.hair}/${look.haircut}`;

  const inSeatOrder = [...agents].sort((left, right) =>
    left.roomId.localeCompare(right.roomId) || left.seat - right.seat || left.id.localeCompare(right.id));

  for (const agent of inSeatOrder) {
    const discipline = disciplineOf(agent);
    const own = lookOf(agent.id, discipline);
    const taken = takenByRoom.get(agent.roomId) ?? new Set<string>();
    takenByRoom.set(agent.roomId, taken);

    const start = HAIR.indexOf(own.hair as (typeof HAIR)[number]) * HAIRCUTS.length + own.haircut;
    let look = own;

    for (let step = 0; step < COMBINATIONS; step += 1) {
      const index = (start + step) % COMBINATIONS;
      const candidate: Look = { hair: HAIR[Math.floor(index / HAIRCUTS.length)]!, haircut: index % HAIRCUTS.length, discipline };
      if (!taken.has(keyOf(candidate))) {
        look = candidate;
        break;
      }
    }

    // More people of one discipline in one room than there are looks: the
    // rest share, which is the best that can be drawn at this size.
    taken.add(keyOf(look));
    looks.set(agent.id, look);
  }

  return looks;
}

function palette(look: Look): Record<string, string> {
  const outfit = OUTFIT[look.discipline];

  return {
    o: INK,
    h: look.hair,
    s: HEAD,
    S: HEAD_SHADE,
    e: INK,
    m: MOUTH,
    b: outfit.shirt,
    B: outfit.shade,
    r: outfit.accent,
    w: LIGHT,
    k: DARK,
    a: METAL,
  };
}

/** The whole figure as runs of colour, ready to draw. */
export function figureRuns(look: Look): PixelRun[] {
  const rows = BASE.map((row, index) => HAIRCUTS[look.haircut]?.[index] ?? row).map((row) => [...row]);

  for (const [x, y, key] of WEARS[look.discipline]) {
    if (rows[y]?.[x] !== undefined) rows[y]![x] = key;
  }

  return runsOf(rows.map((row) => row.join("")), palette(look));
}

/**
 * Below the seated figure, when an agent stands up to carry work across the
 * floor: hips, then legs in one of two strides. Keys: k trousers, o outline
 * and shoes. Two frames and nothing more - the step reads at this size, and
 * a walk is only ever drawn while real work is being carried.
 */
const LEGS: readonly [readonly string[], readonly string[]] = [
  [
    "..okkkkkko..",
    "..okko.okko.",
    ".ooo....ooo.",
  ],
  [
    "..okkkkkko..",
    "...okkkko...",
    "...oooooo...",
  ],
];

export const STANDING_HEIGHT = FIGURE_HEIGHT + LEGS[0].length;

/**
 * The same figure on its feet, in one of the two walking frames. Everything
 * above the waist is exactly the seated figure, so the agent who stands up
 * is recognisably the one who was sitting.
 */
export function walkingRuns(look: Look, frame: 0 | 1): PixelRun[] {
  const legs = runsOf([...LEGS[frame]], palette(look)).map((run) => ({ ...run, y: run.y + FIGURE_HEIGHT }));
  return [...figureRuns(look), ...legs];
}

/** The item on their desk, as runs of colour. */
export function deskItemRuns(look: Look): PixelRun[] {
  return runsOf(DESK_ITEMS[look.discipline], palette(look));
}

function runsOf(rows: string[], colours: Record<string, string>): PixelRun[] {
  const runs: PixelRun[] = [];

  rows.forEach((row, y) => {
    let x = 0;

    while (x < row.length) {
      const key = row[x]!;
      const fill = colours[key];

      if (!fill) {
        x += 1;
        continue;
      }

      let width = 1;
      while (row[x + width] === key) width += 1;

      runs.push({ x, y, width, fill });
      x += width;
    }
  });

  return runs;
}
