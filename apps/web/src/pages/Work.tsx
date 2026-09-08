import { Search } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchWorkList,
  formatDuration,
  formatRelativeTime,
  type WorkItem,
  type WorkStatus,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

import { statusLabel, toneClass, workStatusTone } from "../lib/tone";

const filters: Array<{ id: WorkStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "executing", label: "Executing" },
  { id: "waiting_approval", label: "Waiting" },
  { id: "queued", label: "Queued" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

/** The plan the planner wrote for this objective, when it wrote one. */
function planOf(work: WorkItem): { taskCount?: number } {
  const plan = work.metadata.plan;
  return typeof plan === "object" && plan !== null
    ? (plan as { taskCount?: number })
    : {};
}

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

  const total = work.data?.length ?? 0;

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Operate"
        title="EVERY OBJECTIVE"
        lead="THE COMPANY HAS TAKEN."
        detail="From the plan it produced to the result it delivered, newest first."
        // Deliberately not "broken" when the list merely contains old
        // failures. A page that stays red because something went wrong last
        // week teaches people that red means nothing; the failed count below
        // is red on its own, and each failed row carries its reason.
        tone={counts.executing > 0 ? "moving" : "quiet"}
        meta={
          <>
            <Reading
              label="Executing"
              value={counts.executing ?? 0}
              tone="active"
              live={(counts.executing ?? 0) > 0}
            />
            <Reading
              label="Waiting"
              value={counts.waiting_approval ?? 0}
              tone="warning"
              live={(counts.waiting_approval ?? 0) > 0}
            />
            <Reading
              label="Completed"
              value={counts.completed ?? 0}
              tone="live"
            />
            <Reading
              label="Failed"
              value={counts.failed ?? 0}
              tone="error"
              live={(counts.failed ?? 0) > 0}
            />
          </>
        }
      />

      <div className="mx-auto max-w-[1180px]">
        <div className="mb-2 flex flex-wrap items-center gap-3">
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

        {work.loading ? (
          <Connecting what="Fetching the company's work…" />
        ) : work.error ? (
          <Failure
            headline={
              work.error.isOffline ? "The company is unreachable" : "That read failed"
            }
            detail={work.error.message}
            consequence="Work already on the queue keeps running; this page just cannot see it."
            action={
              <button type="button" onClick={work.reload} className="button-ghost">
                Try again
              </button>
            }
          />
        ) : visible.length === 0 ? (
          total === 0 ? (
            <Quiet
              line="The company is quiet."
              detail="Nothing has been asked of it yet. Give it an objective and every step it takes — the plan, who it went to, which tools were called — is recorded here."
              action={
                <Link to="/command" className="button-primary">
                  Go to the Command Center
                </Link>
              }
            />
          ) : (
            <Quiet
              line="Nothing matches that."
              detail="Try another status, or clear the search."
              action={
                <button
                  type="button"
                  className="button-ghost"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                >
                  Clear filters
                </button>
              }
            />
          )
        ) : (
          <div className="ledger">
            {visible.map((item, index) => {
              const plan = planOf(item);
              const ran = formatDuration(item.startedAt, item.completedAt);

              return (
                <Link
                  key={item.id}
                  to={`/work/${item.id}`}
                  className="ledger-row"
                >
                  <span
                    className={`ledger-rail ${toneClass[workStatusTone(item.status)]}${item.status === "executing" ? " op-rail-running" : ""}`}
                  />

                  <span className="ledger-index">
                    {String(visible.length - index).padStart(3, "0")}
                  </span>

                  <span className="min-w-0">
                    <span className="ledger-title">{item.objective}</span>

                    <span className="ledger-meta">
                      <span>{formatRelativeTime(item.createdAt)}</span>

                      <span className="uppercase">{item.priority}</span>

                      {plan.taskCount !== undefined && (
                        <span>
                          {plan.taskCount}{" "}
                          {plan.taskCount === 1 ? "task" : "tasks"}
                        </span>
                      )}

                      {ran !== "—" && <span>ran {ran}</span>}
                    </span>

                    {typeof item.metadata.executionError === "string" && (
                      <span className="ledger-preview text-[#c9868a]">
                        {item.metadata.executionError}
                      </span>
                    )}
                  </span>

                  <span className="ledger-status">
                    <StatusPill
                      tone={workStatusTone(item.status)}
                      pulse={item.status === "executing"}
                    >
                      {statusLabel(item.status)}
                    </StatusPill>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
