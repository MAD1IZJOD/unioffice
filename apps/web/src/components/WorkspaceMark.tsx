import { useMemo } from "react";

/**
 * A workspace's mark.
 *
 * Four workspaces called Engineering, Research, Finance and Operations should
 * not look like four copies of the same rounded square, but hard-coding a look
 * per department name would be decoration that stops being true the moment
 * someone names a workspace something else. So the figure is derived from the
 * workspace's own slug: a lattice whose density, rotation and weave come from
 * a stable hash of it. The same workspace always draws the same mark, a
 * renamed one draws a new mark, and nothing had to be listed in advance.
 *
 * Colour is deliberately not part of it. The mark inherits `--tone` from
 * whatever row it sits in, so the palette keeps meaning what it means
 * everywhere else in the product rather than turning the directory into a
 * colour wheel.
 */
export function WorkspaceMark({
  slug,
  /** Real agent count. How many nodes the lattice carries. */
  members = 0,
  size = 32,
  active = false,
}: {
  slug: string;
  members?: number;
  size?: number;
  active?: boolean;
}) {
  const figure = useMemo(() => drawLattice(slug, members), [slug, members]);

  return (
    <svg
      className={`workspace-mark${active ? " workspace-mark-active" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      {figure}
    </svg>
  );
}

/** A cheap stable hash, the same one the agent marks use. */
function seedOf(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

function drawLattice(slug: string, members: number) {
  const seed = seedOf(slug || "workspace");

  // Three to six ribs, so every workspace is legibly different without any
  // of them becoming a smudge.
  const ribs = 3 + (seed % 4);
  const rotation = seed % 90;
  const inset = 4 + (seed % 3);
  // A node per agent, capped so a large workspace stays a mark rather than
  // becoming a diagram.
  const nodes = Math.max(0, Math.min(members, ribs));

  const span = 32 - inset * 2;
  const step = span / (ribs - 1);

  return (
    <g
      className="workspace-mark-body"
      transform={`rotate(${rotation} 16 16)`}
    >
      <rect
        x={inset}
        y={inset}
        width={span}
        height={span}
        className="workspace-mark-frame"
      />

      {Array.from({ length: ribs }, (_, index) => {
        const offset = inset + step * index;

        return (
          <g key={index}>
            <line
              x1={offset}
              y1={inset}
              x2={offset}
              y2={inset + span}
              className="workspace-mark-rib"
            />
            <line
              x1={inset}
              y1={offset}
              x2={inset + span}
              y2={offset}
              className="workspace-mark-rib"
            />
          </g>
        );
      })}

      {Array.from({ length: nodes }, (_, index) => {
        const offset = inset + step * index;

        return (
          <circle
            key={index}
            cx={offset}
            cy={offset}
            r="1.9"
            className="workspace-mark-node"
          />
        );
      })}
    </g>
  );
}

/** The letters a workspace is known by when there is no room for a mark. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "—";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();

  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}
