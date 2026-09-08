import { useMemo } from "react";

import { disciplineOf, type Discipline } from "../lib/workforce";

export interface AgentMarkProps {
  /** The agent's real id. Seeds the small deterministic variation. */
  agentId: string;
  /** Real capabilities. How many members the figure is drawn from. */
  capabilities: string[];
  /** Real tool grants. A granted tool becomes a filled node. */
  tools: number;
  /** Real agent type, so an orchestrator always draws as one. */
  type?: string;
  size?: number;
  /** Live presence. Drives whether the core reads as running. */
  active?: boolean;
}

/**
 * One agent's mark.
 *
 * Six agents that all rendered the same wheel with a different rotation read
 * as one entity duplicated six times. These are six different figures, and
 * which one an agent gets is decided by the capabilities the backend granted
 * it: a hub of routes for the orchestrator, a truss for the engineer, a
 * measured column for the quantitative specialist, converging arcs for the
 * researcher, a linked chain for operations, a wavefront for communication.
 *
 * Everything inside a figure is a real quantity - a member per capability, a
 * filled node per authorized tool - so an agent holding no tools visibly
 * holds no tools, and adding a seventh agent produces a coherent mark without
 * anyone drawing one.
 *
 * Colour is never part of the mark. It inherits `--tone`, which the
 * surrounding row sets from live presence, so the palette stays semantic
 * instead of turning the roster into a colour wheel.
 */
export function AgentMark({
  agentId,
  capabilities,
  tools,
  type,
  size = 32,
  active = false,
}: AgentMarkProps) {
  const discipline = disciplineOf({ type, capabilities });

  const figure = useMemo(
    () => drawFigure(discipline, agentId, capabilities.length, tools),
    [discipline, agentId, capabilities.length, tools],
  );

  return (
    <svg
      className={`agent-mark agent-mark-${discipline}${active ? " agent-mark-active" : ""}`}
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

/** A cheap stable hash: the same agent always draws the same mark. */
function seedOf(agentId: string): number {
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = (hash * 31 + agentId.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function drawFigure(
  discipline: Discipline,
  agentId: string,
  capabilityCount: number,
  tools: number,
) {
  const seed = seedOf(agentId);
  const members = Math.max(3, Math.min(capabilityCount || 3, 6));
  const filled = Math.max(0, Math.min(tools, 4));

  switch (discipline) {
    case "orchestration":
      return orchestrationFigure(seed, members, filled);
    case "engineering":
      return engineeringFigure(members, filled);
    case "quantitative":
      return quantitativeFigure(seed, members, filled);
    case "research":
      return researchFigure(members, filled);
    case "operations":
      return operationsFigure(members, filled);
    case "communication":
      return communicationFigure(members, filled);
    default:
      return generalFigure(seed, members, filled);
  }
}

/** A hub that routes outward. Routes are capabilities; held tools fill. */
function orchestrationFigure(seed: number, members: number, filled: number) {
  const rotation = seed % 60;

  return (
    <g className="mark-body" transform={`rotate(${rotation} 16 16)`}>
      {Array.from({ length: members }, (_, index) => {
        const angle = (index / members) * Math.PI * 2;
        const x = 16 + Math.cos(angle) * 11.5;
        const y = 16 + Math.sin(angle) * 11.5;

        return (
          <g key={index}>
            <line x1="16" y1="16" x2={x} y2={y} className="mark-line" />
            <circle
              cx={x}
              cy={y}
              r="1.7"
              className={index < filled ? "mark-node-filled" : "mark-node"}
            />
          </g>
        );
      })}

      <circle cx="16" cy="16" r="3.4" className="mark-core" />
    </g>
  );
}

/** A truss. Chords and braces are capabilities; bolts are tools. */
function engineeringFigure(members: number, filled: number) {
  const top = 7;
  const bottom = 25;
  const step = 20 / members;

  return (
    <g className="mark-body">
      <line x1="6" y1={top} x2="26" y2={top} className="mark-line" />
      <line x1="6" y1={bottom} x2="26" y2={bottom} className="mark-line" />

      {Array.from({ length: members }, (_, index) => {
        const x = 6 + index * step;
        const next = x + step;

        return (
          <g key={index}>
            <line x1={x} y1={top} x2={x} y2={bottom} className="mark-line" />
            <line
              x1={x}
              y1={index % 2 === 0 ? top : bottom}
              x2={next}
              y2={index % 2 === 0 ? bottom : top}
              className="mark-brace"
            />
          </g>
        );
      })}

      {Array.from({ length: filled }, (_, index) => (
        <rect
          key={index}
          x={6.6 + index * 5}
          y={index % 2 === 0 ? top - 1.4 : bottom - 1.4}
          width="2.8"
          height="2.8"
          className="mark-node-filled"
        />
      ))}
    </g>
  );
}

/** A measured column. Bars are capabilities; capped bars are tools. */
function quantitativeFigure(seed: number, members: number, filled: number) {
  const baseline = 25;
  const width = 22 / members;

  return (
    <g className="mark-body">
      <line x1="5" y1={baseline} x2="27" y2={baseline} className="mark-line" />

      {Array.from({ length: members }, (_, index) => {
        // Deterministic heights: the same agent measures the same every time.
        const wobble = ((seed >> (index * 3)) & 7) / 7;
        const height = 5 + wobble * 12;
        const x = 5.6 + index * width + width / 2;

        return (
          <g key={index}>
            <line
              x1={x}
              y1={baseline}
              x2={x}
              y2={baseline - height}
              className="mark-bar"
            />

            {index < filled && (
              <rect
                x={x - 1.5}
                y={baseline - height - 2.6}
                width="3"
                height="2.2"
                className="mark-node-filled"
              />
            )}
          </g>
        );
      })}

      <line x1="5" y1={baseline + 2.6} x2="9" y2={baseline + 2.6} className="mark-tick" />
      <line x1="23" y1={baseline + 2.6} x2="27" y2={baseline + 2.6} className="mark-tick" />
    </g>
  );
}

/** Arcs converging on a finding. Arcs are capabilities; tools fill. */
function researchFigure(members: number, filled: number) {
  return (
    <g className="mark-body">
      {Array.from({ length: members }, (_, index) => {
        const radius = 4.5 + index * (11 / members);

        return (
          <path
            key={index}
            d={`M ${22 - radius} ${16 - radius * 0.82} A ${radius} ${radius} 0 0 0 ${22 - radius} ${16 + radius * 0.82}`}
            className="mark-arc"
            style={{ "--arc-index": index } as React.CSSProperties}
          />
        );
      })}

      <circle cx="22.5" cy="16" r="2.6" className="mark-core" />

      {Array.from({ length: filled }, (_, index) => (
        <circle
          key={index}
          cx="27"
          cy={10 + index * 4}
          r="1.5"
          className="mark-node-filled"
        />
      ))}
    </g>
  );
}

/** A process chain. Links are capabilities; tools fill the stations. */
function operationsFigure(members: number, filled: number) {
  const points = Array.from({ length: members }, (_, index) => ({
    x: 6 + (index * 20) / (members - 1 || 1),
    y: 16 + Math.sin((index / Math.max(members - 1, 1)) * Math.PI * 1.3) * 7 - 3,
  }));

  return (
    <g className="mark-body">
      <path
        d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}
        className="mark-path"
      />

      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r="2.1"
          className={index < filled ? "mark-node-filled" : "mark-node"}
          style={{ "--node-index": index } as React.CSSProperties}
        />
      ))}
    </g>
  );
}

/** A wavefront leaving a source. Fronts are capabilities; tools fill. */
function communicationFigure(members: number, filled: number) {
  return (
    <g className="mark-body">
      <circle cx="7" cy="16" r="2.4" className="mark-core" />

      {Array.from({ length: members }, (_, index) => {
        const radius = 5 + index * (17 / members);

        return (
          <path
            key={index}
            d={`M ${7 + radius * 0.62} ${16 - radius * 0.78} A ${radius} ${radius} 0 0 1 ${7 + radius * 0.62} ${16 + radius * 0.78}`}
            className="mark-wave"
            style={{ "--wave-index": index } as React.CSSProperties}
          />
        );
      })}

      {Array.from({ length: filled }, (_, index) => (
        <circle
          key={index}
          cx="6.5"
          cy={7 + index * 6}
          r="1.4"
          className="mark-node-filled"
        />
      ))}
    </g>
  );
}

/** Fallback for an agent whose capabilities name no discipline. */
function generalFigure(seed: number, members: number, filled: number) {
  return (
    <g className="mark-body" transform={`rotate(${seed % 90} 16 16)`}>
      {Array.from({ length: members }, (_, index) => {
        const angle = (index / members) * Math.PI * 2;

        return (
          <line
            key={index}
            x1={16 + Math.cos(angle) * 4}
            y1={16 + Math.sin(angle) * 4}
            x2={16 + Math.cos(angle) * 12}
            y2={16 + Math.sin(angle) * 12}
            className="mark-line"
          />
        );
      })}

      {Array.from({ length: filled }, (_, index) => {
        const angle = ((index + 0.5) / Math.max(filled, 1)) * Math.PI * 2;

        return (
          <circle
            key={index}
            cx={16 + Math.cos(angle) * 13}
            cy={16 + Math.sin(angle) * 13}
            r="1.6"
            className="mark-node-filled"
          />
        );
      })}
    </g>
  );
}
