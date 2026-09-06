import { GitBranch, Search } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchWorkList,
  formatRelativeTime,
  type WorkItem,
  type WorkStatus,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  EmptyState,
  ErrorState,
  Panel,
  SectionHeading,
  Skeleton,
  StatusPill,
  TimeStamp,
} from "../components/primitives";

import {
  statusLabel,
  workStatusTone,
} from "../lib/tone";

const filters: Array<{ id: WorkStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "executing", label: "Executing" },
  { id: "waiting_approval", label: "Waiting" },
  { id: "queued", label: "Queued" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

export default function Work() {
  const [filter, setFilter] = useState<WorkStatus | "all">("all");
  const [query, setQuery] = useState("");

  const work = useResource<WorkItem[]>(
    useCallback(() => fetchWorkList({ limit: 100 }), []),
    { pollMs: 20_000 },
  );

  const visible = useMemo(() => {
    const items = work.data ?? [];
    const needle = query.trim().toLowerCase();

    return items.filter(
      (item) =>
        (filter === "all" || item.status === filter) &&
        (!needle || item.objective.toLowerCase().includes(needle)),
    );
  }, [work.data, filter, query]);

  const counts = useMemo(() => {
    const items = work.data ?? [];

    return filters.reduce<Record<string, number>>((totals, entry) => {
      totals[entry.id] =
        entry.id === "all"
          ? items.length
          : items.filter((item) => item.status === entry.id).length;
      return totals;
    }, {});
  }, [work.data]);

  return (
    <div className="mx-auto max-w-[1180px] fade-up">
      <SectionHeading
        title="Work"
        description="Every objective the company has been given, from the plan it produced to the result it delivered."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="filter-group">
          {filters.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={`filter-tab${filter === entry.id ? " filter-tab-active" : ""}`}
            >
              {entry.label}
              {work.data && (
                <span className="filter-count">{counts[entry.id] ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        <label className="search-field ml-auto">
          <Search size={13} className="text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search objectives"
            aria-label="Search objectives"
          />
        </label>
      </div>

      <Panel padded={false}>
        {work.loading ? (
          <div className="p-[18px]">
            <Skeleton rows={6} />
          </div>
        ) : work.error ? (
          <ErrorState
            message={work.error.message}
            offline={work.error.isOffline}
            onRetry={work.reload}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={GitBranch}
            title={
              (work.data?.length ?? 0) === 0
                ? "No work has been created yet"
                : "Nothing matches this filter"
            }
            description={
              (work.data?.length ?? 0) === 0
                ? "Give the company an objective from the Command Center and it will appear here with its full execution history."
                : "Try a different status or clear the search."
            }
            action={
              (work.data?.length ?? 0) === 0 ? (
                <Link to="/command" className="button-primary">
                  Go to Command Center
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="stack-list">
            {visible.map((item) => (
              <Link key={item.id} to={`/work/${item.id}`} className="row-link">
                <div className="flex items-start justify-between gap-5">
                  <p className="line-clamp-2 flex-1 text-[12.5px] leading-[1.65] text-slate-200">
                    {item.objective}
                  </p>

                  <StatusPill
                    tone={workStatusTone(item.status)}
                    pulse={item.status === "executing"}
                  >
                    {statusLabel(item.status)}
                  </StatusPill>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-4">
                  <TimeStamp
                    iso={item.createdAt}
                    relative={formatRelativeTime(item.createdAt)}
                  />

                  <span className="mono text-[9px] uppercase tracking-[0.11em] text-slate-600">
                    {item.priority} priority
                  </span>

                  {typeof item.metadata.plan === "object" &&
                    item.metadata.plan !== null && (
                      <span className="mono text-[9px] text-slate-600">
                        {String(
                          (item.metadata.plan as Record<string, unknown>)
                            .taskCount ?? "?",
                        )}{" "}
                        tasks
                      </span>
                    )}

                  {typeof item.metadata.executionError === "string" && (
                    <span className="mono truncate text-[9px] text-red-400/80">
                      {item.metadata.executionError}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
