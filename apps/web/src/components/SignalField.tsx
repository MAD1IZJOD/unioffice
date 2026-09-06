import { useMemo } from "react";

import type { CompanyStatement } from "../lib/statement";

export interface SignalFieldProps {
  mood: CompanyStatement["mood"];
  /** Real counts. Density is derived from them, never invented. */
  activity: number;
  agents: number;
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
 * It is a readout, not decoration: the number of traces is the number of
 * agents on the roster, and how far each one reaches across is that agent's
 * real share of recent activity. A quiet company draws a nearly flat field; a
 * busy one draws a dense one. Nothing here animates on a timer, so an idle
 * page costs nothing.
 *
 * Deliberately SVG rather than canvas or WebGL - it is a few dozen paths, it
 * scales, and it disappears entirely under prefers-reduced-motion without
 * needing a code path of its own.
 */
export function SignalField({ mood, activity, agents }: SignalFieldProps) {
  const stroke = MOOD_STROKE[mood];

  const traces = useMemo(() => {
    // One trace per agent, capped so a large roster stays legible.
    const count = Math.max(3, Math.min(agents || 3, 10));
    const intensity = Math.min(activity, 40) / 40;

    return Array.from({ length: count }, (_, index) => {
      const y = 8 + (index * 84) / count;
      // A deterministic wobble per row: the same company always draws the
      // same field, so the page does not shimmer between polls.
      const seed = Math.sin((index + 1) * 12.9898) * 43758.5453;
      const wobble = (seed - Math.floor(seed)) * 2 - 1;
      const reach = 18 + intensity * 74 + wobble * 8;
      const lift = wobble * (3 + intensity * 6);

      return {
        d: `M0 ${y} C ${reach * 0.3} ${y + lift}, ${reach * 0.65} ${y - lift}, ${reach} ${y + lift * 0.4}`,
        opacity: 0.10 + (index % 3) * 0.05 + intensity * 0.22,
        width: index % 4 === 0 ? 0.5 : 0.3,
      };
    });
  }, [agents, activity]);

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
        />
      ))}
    </svg>
  );
}
