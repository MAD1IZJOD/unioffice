import { AGENT_FILTERS, type AgentFilter } from "./filters";

/**
 * "Show me only the agents doing this." One button per state the server
 * records, each with how many agents are in it right now; Everyone clears
 * them. It filters what is shown and nothing else - nobody's state changes.
 */
export function FilterBar({
  counts,
  picked,
  total,
  shown,
  onToggle,
  onClear,
}: {
  counts: Record<AgentFilter, number>;
  picked: ReadonlySet<AgentFilter>;
  total: number;
  shown: number;
  onToggle: (filter: AgentFilter) => void;
  onClear: () => void;
}) {
  return (
    <div className="world-filters">
      <div className="world-filter-group" role="group" aria-label="Show only">
        <button type="button" className="world-filter" aria-pressed={picked.size === 0} onClick={onClear}>
          Everyone <span className="world-filter-count">{total}</span>
        </button>
        {AGENT_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className="world-filter"
            aria-pressed={picked.has(filter.id)}
            onClick={() => onToggle(filter.id)}
          >
            {filter.label} <span className="world-filter-count">{counts[filter.id]}</span>
          </button>
        ))}
      </div>

      {picked.size > 0 && (
        <p className="world-meta" role="status">
          {shown === 0
            ? "Nobody is in that state right now."
            : `Showing ${shown} of ${total} ${total === 1 ? "agent" : "agents"}.`}
        </p>
      )}
    </div>
  );
}
