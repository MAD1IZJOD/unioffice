import { useMemo } from "react";

export interface AgentSigilProps {
  /** The agent's real id - the glyph is derived from it, so it is stable. */
  agentId: string;
  /** Real capabilities. More capability means more spokes. */
  capabilities: string[];
  /** Real tool grants. A granted tool becomes a filled node. */
  tools: number;
  size?: number;
  /** Live presence drives the colour and whether the core pulses. */
  active?: boolean;
  tone?: string;
}

/**
 * A generated mark for one agent.
 *
 * Agents needed to look like distinct entities rather than interchangeable
 * avatars, but inventing artwork per agent would be decoration that says
 * nothing. So the glyph is computed from what the agent actually is: a spoke
 * per capability, a node per authorised tool, and a rotation seeded by its id.
 * Tony and Harvey genuinely differ because they genuinely differ, and a new
 * agent gets a coherent mark without anyone drawing one.
 */
export function AgentSigil({
  agentId,
  capabilities,
  tools,
  size = 34,
  active = false,
  tone,
}: AgentSigilProps) {
  const geometry = useMemo(() => {
    // A cheap stable hash of the id; same agent, same mark, every render.
    let hash = 0;
    for (let index = 0; index < agentId.length; index += 1) {
      hash = (hash * 31 + agentId.charCodeAt(index)) | 0;
    }

    const rotation = Math.abs(hash) % 360;
    const spokes = Math.max(3, Math.min(capabilities.length || 3, 6));
    const nodes = Math.max(0, Math.min(tools, 4));

    return {
      rotation,
      spokes: Array.from({ length: spokes }, (_, index) => {
        const angle = (index / spokes) * Math.PI * 2;
        return {
          x2: 16 + Math.cos(angle) * 11,
          y2: 16 + Math.sin(angle) * 11,
        };
      }),
      nodes: Array.from({ length: nodes }, (_, index) => {
        const angle = ((index + 0.5) / Math.max(nodes, 1)) * Math.PI * 2;
        return {
          cx: 16 + Math.cos(angle) * 13,
          cy: 16 + Math.sin(angle) * 13,
        };
      }),
    };
  }, [agentId, capabilities.length, tools]);

  return (
    <svg
      className={`agent-sigil${active ? " agent-sigil-active" : ""} ${tone ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`rotate(${geometry.rotation} 16 16)`}>
        {geometry.spokes.map((spoke, index) => (
          <line
            key={index}
            x1="16"
            y1="16"
            x2={spoke.x2}
            y2={spoke.y2}
            strokeWidth="1.1"
            className="sigil-spoke"
          />
        ))}

        {geometry.nodes.map((node, index) => (
          <circle
            key={index}
            cx={node.cx}
            cy={node.cy}
            r="1.8"
            className="sigil-node"
          />
        ))}
      </g>

      <circle cx="16" cy="16" r="3.2" className="sigil-core" />
    </svg>
  );
}
