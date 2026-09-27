import { memo, type KeyboardEvent } from "react";

import type { WorldAgent } from "../lib/api";
import { disciplineOf } from "../lib/workforce";

import { agentLabel, deskStateOf, type DeskState } from "./describe";
import type { PlacedSeat } from "./layout";
import { deskItemRuns, figureRuns, lookOf, type PixelRun } from "./sprites";

/**
 * One agent at their desk.
 *
 * Everything on the desk that changes says something the server said. The
 * monitor is lit and the hands move only while the agent is on a step; a
 * lock sits on the screen when the step is in a mission the viewer cannot
 * open; a red bubble means a person is needed; the planner's bubble means a
 * plan is being written. The lamp on the desk front carries the same state
 * as a colour, so it can be read at a glance and at any zoom. An idle agent
 * sits still - nothing here moves to look busy.
 *
 * The desk is a 40 x 40 cell, drawn in art pixels.
 */
export const Desk = memo(function Desk({
  agent,
  seat,
  roomName,
  selected,
  onSelect,
}: {
  agent: WorldAgent;
  seat: PlacedSeat;
  roomName?: string;
  selected: boolean;
  onSelect: (agentId: string) => void;
}) {
  const state = deskStateOf(agent);
  const look = lookOf(agent.id, disciplineOf(agent));
  const figure = figureRuns(look);
  const item = deskItemRuns(look);

  const choose = () => onSelect(agent.id);
  const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose();
    }
  };

  return (
    <g
      className={`world-desk world-desk-${state}${selected ? " world-desk-selected" : ""}`}
      transform={`translate(${seat.cell.x} ${seat.cell.y})`}
      role="button"
      tabIndex={0}
      aria-label={agentLabel(agent, roomName)}
      aria-pressed={selected}
      data-agent-id={agent.id}
      onClick={choose}
      onKeyDown={onKeyDown}
    >
      <rect className="world-hit" x={0} y={0} width={40} height={40} />
      <rect className="world-focus" x={0.5} y={0.5} width={39} height={39} rx={1} />

      {/* The chair, behind whoever sits in it. */}
      <rect className="world-chair" x={11} y={8} width={18} height={12} />
      <rect className="world-chair-top" x={11} y={8} width={18} height={1} />

      <g className="world-figure" transform="translate(14 7)">
        <Runs runs={figure} />
      </g>

      <Bubble state={state} />

      {/* The desk. */}
      <rect className="world-desk-top" x={3} y={19} width={34} height={2} />
      <rect className="world-desk-edge" x={3} y={21} width={34} height={1} />
      <rect className="world-desk-front" x={4} y={22} width={32} height={7} />
      <rect className="world-desk-handle" x={18} y={25} width={4} height={1} />
      <rect className="world-lamp" x={6} y={24} width={3} height={3} />

      {/* Hands on the desk; they type only while a step is running. */}
      <rect className="world-hand world-hand-left" x={16} y={18} width={2} height={1} />
      <rect className="world-hand world-hand-right" x={22} y={18} width={2} height={1} />

      <g transform="translate(4 11)">
        <Runs runs={item} />
      </g>

      <Monitor state={state} />

      <text className="world-name" x={20} y={36} textAnchor="middle">
        {agent.name}
      </text>
    </g>
  );
});

function Monitor({ state }: { state: DeskState }) {
  return (
    <g className="world-monitor">
      <rect className="world-monitor-frame" x={27} y={10} width={11} height={8} />
      <rect className={`world-screen world-screen-${state}`} x={28} y={11} width={9} height={6} />
      {state === "working" && (
        <g className="world-code">
          <rect x={29} y={12} width={5} height={1} />
          <rect x={29} y={14} width={6} height={1} />
          <rect x={30} y={16} width={3} height={1} />
        </g>
      )}
      {state === "elsewhere" && (
        <g className="world-lock">
          <rect x={31} y={12} width={3} height={1} />
          <rect x={31} y={12} width={1} height={2} />
          <rect x={33} y={12} width={1} height={2} />
          <rect x={30} y={14} width={5} height={2} />
        </g>
      )}
      <rect className="world-monitor-frame" x={31} y={18} width={3} height={1} />
    </g>
  );
}

/** Said above the head only when there is something to say. */
function Bubble({ state }: { state: DeskState }) {
  if (state === "waiting") {
    return (
      <g className="world-bubble world-bubble-waiting">
        <rect x={25} y={0} width={9} height={7} />
        <rect x={27} y={7} width={2} height={1} />
        <rect className="world-bubble-glyph" x={29} y={1} width={1} height={3} />
        <rect className="world-bubble-glyph" x={29} y={5} width={1} height={1} />
      </g>
    );
  }

  if (state === "planning") {
    return (
      <g className="world-bubble world-bubble-planning">
        <rect x={25} y={0} width={11} height={6} />
        <rect x={27} y={6} width={2} height={1} />
        <rect className="world-bubble-glyph world-dot-1" x={27} y={3} width={1} height={1} />
        <rect className="world-bubble-glyph world-dot-2" x={30} y={3} width={1} height={1} />
        <rect className="world-bubble-glyph world-dot-3" x={33} y={3} width={1} height={1} />
      </g>
    );
  }

  if (state === "paused") {
    return (
      <g className="world-bubble world-bubble-paused">
        <rect className="world-bubble-glyph" x={28} y={1} width={4} height={1} />
        <rect className="world-bubble-glyph" x={30} y={2} width={1} height={1} />
        <rect className="world-bubble-glyph" x={29} y={3} width={1} height={1} />
        <rect className="world-bubble-glyph" x={28} y={4} width={4} height={1} />
      </g>
    );
  }

  return null;
}

export function Runs({ runs }: { runs: PixelRun[] }) {
  return (
    <>
      {runs.map((run) => (
        <rect key={`${run.x},${run.y}`} x={run.x} y={run.y} width={run.width} height={1} fill={run.fill} />
      ))}
    </>
  );
}
