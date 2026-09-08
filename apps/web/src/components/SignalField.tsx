import { useMemo } from "react";

import type { CompanyStatement } from "../lib/statement";

export interface SignalFieldProps {
  mood: CompanyStatement["mood"];
  /** Real counts. Density is derived from them, never invented. */
  activity: number;
  agents: number;
  /** Real running work. The only thing that makes the field move. */
  executing?: number;
}

const MOOD_STROKE: Record<CompanyStatement["mood"], string> = {
  waiting: "#e5484d",
  moving: "#3b82f6",
  broken: "#e5484d",
  quiet: "#2a313c",
};

/**
 * The backdrop behind the Command Center statement.
 *
 * It is a readout, not decoration: one trace per agent on the roster, each
 * reaching across in proportion to real recent activity. A quiet company
 * draws a nearly flat field; a busy one draws a dense one.
 *
 * The one thing that moves is the traces belonging to work that is genuinely
 * executing right now - as many as there are running objectives, no more. An
 * idle company draws a completely static field, which is the point: motion
 * here means something is actually happening, so the page cannot look busy
 * while the company is asleep.
 *
 * Deliberately SVG rather than canvas or WebGL. It is a few dozen paths, it
 * scales, and it stops entirely under prefers-reduced-motion without needing
 * a code path of its own.
 */
export function SignalField({
  mood,
  activity,
  agents,
  executing = 0,
}: SignalFieldProps) {
  const stroke = MOOD_STROKE[mood];

  const traces = useMemo(() => {
    // One trace per agent, capped so a large roster stays legible.
    const count = Math.max(3, Math.min(agents || 3, 10));
    const intensity = Math.min(activity, 40) / 40;
    const live = Math.min(executing, count);

    return Array.from({ length: count }, (_, index) => {
      const y = 8 + (index * 84) / count;
      // A deterministic wobble per row: the same company always draws the
      // same field, so the page does not shimmer between polls.
      const seed = Math.sin((index + 1) * 12.9898) * 43758.5453;
      const wobble = (seed - Math.floor(seed)) * 2 - 1;
      const reach = 18 + intensity * 74 + wobble * 8;
      const lift = wobble * (3 + intensity * 6);

      // Drawn right-to-left. Anchored on the left they ran underneath the
      // headline and read as accidental rules through the type; from the
      // right they occupy the half of the composition the words leave empty.
      const start = 100;
      const end = 100 - reach;

      return {
        d: `M${start} ${y} C ${start - reach * 0.3} ${y + lift}, ${start - reach * 0.65} ${y - lift}, ${end} ${y + lift * 0.4}`,
        opacity: 0.1 + (index % 3) * 0.05 + intensity * 0.22,
        width: index % 4 === 0 ? 0.5 : 0.3,
        running: index < live,
      };
    });
  }, [agents, activity, executing]);

  return (
    <svg
      className="signal-field"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {traces.map((trace, index) => (
        <path
          key={index}
          d={trace.d}
          fill="none"
          stroke={stroke}
          strokeWidth={trace.width}
          strokeOpacity={trace.opacity}
          vectorEffect="non-scaling-stroke"
          className={trace.running ? "signal-trace-running" : undefined}
          style={
            trace.running
              ? ({ "--trace-index": index } as React.CSSProperties)
              : undefined
          }
        />
      ))}
    </svg>
  );
}
