import { Plus, Search } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchOverview,
  fetchWorkList,
  formatDuration,
  formatRelativeTime,
  type CompanyOverview,
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

/**
 * Every mission the company has been given.
 *
 * A stack of operations rather than a table of rows: the objective leads at
 * reading size and underneath it is one line saying what the company is
 * currently doing about it, which is the only thing anyone scans this page
 * for. Who is on it comes from the live roster, so the names here are agents
 * genuinely holding a task on that mission right now.
 */

const FILTERS: Array<{ id: WorkStatus | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "executing", label: "Running" },
  { id: "waiting_approval", label: "Waiting" },
  { id: "queued", label: "Queued" },
  { id: "completed", label: "Delivered" },
  { id: "failed", label: "Stopped" },
];

/** What the company is doing about this objective, in one line. */
function stateLine(work: WorkItem, workers: string[]): string {
  switch (work.status) {
    case "completed":
      return "Delivered.";
    case "failed":
      return work.metadata.interrupted
        ? "Execution stopped part-way. It can be resumed."
        : "It stopped before finishing.";
    case "waiting_approval":
      return "Stopped at a step it will not take without you.";
    case "planning":
      return "The plan is being written.";
    case "executing":
      return workers.length > 0
        ? `${workers.join(" and ")} ${workers.length === 1 ? "is" : "are"} working on it.`
        : "On the queue for a worker.";
    case "cancelled":
      return "Cancelled.";
    default:
      return planOf(work).taskCount === undefined
        ? "Recorded, and not yet planned."
        : "Planned and waiting to run.";
  }
}

function planOf(work: WorkItem): { taskCount?: number } {
  const plan = work.metadata.plan;
  return typeof plan === "object" && plan !== null
    ? (plan as { taskCount?: number })
    : {};
}

export default function Missions() {
  const [filter, setFilter] = useState<WorkStatus | "all">("all");
  const [query, setQuery] = useState("");

  const missions = useResource<WorkItem[]>(
    useCallback(() => fetchWorkList({ limit: 100 }), []),
    { pollMs: 20_000 },
  );

  // Only to name who is on which mission. The same read the shell already
  // makes, so this costs the roster and nothing more.
  const overview = useResource<CompanyOverview>(
    useCallback(() => fetchOverview(1), []),
    { pollMs: 20_000 },
  );

  const workersByMission = useMemo(() => {
    const map = new Map<string, string[]>();

    for (const agent of overview.data?.agents ?? []) {
      if (!agent.activeTask) continue;
      const current = map.get(agent.activeTask.workId) ?? [];
      current.push(agent.name);
      map.set(agent.activeTask.workId, current);
    }

    return map;
  }, [overview.data]);

  const visible = useMemo(() => {
    const items = missions.data ?? [];
    const needle = query.trim().toLowerCase();

    return items.filter(
      (item) =>
        (filter === "all" || item.status === filter) &&
        (!needle || item.objective.toLowerCase().includes(needle)),
    );
  }, [missions.data, filter, query]);

  const counts = useMemo(() => {
    const items = missions.data ?? [];

    return FILTERS.reduce<Record<string, number>>((totals, entry) => {
      totals[entry.id] =
        entry.id === "all"
          ? items.length
          : items.filter((item) => item.status === entry.id).length;
      return totals;
    }, {});
  }, [missions.data]);

  const running = counts.executing ?? 0;
  const total = missions.data?.length ?? 0;

  return (
    <div className="fade-up">
      <PageOpening
        eyebrow="Work"
        title="EVERY MISSION"
        lead="THE COMPANY HAS RUN."
        detail="From the objective you gave it to the result it delivered, newest first."
        // Deliberately not "broken" when the list merely contains old
        // failures. A page that stays red because something went wrong last
        // week teaches people that red means nothing.
        tone={running > 0 ? "moving" : "quiet"}
        action={
          <Link to="/missions/new" className="button-primary">
            <Plus size={13} />
            Open a mission
          </Link>
        }
        meta={
          <>
            <Reading
              label="Running"
              value={running}
              tone="active"
              live={running > 0}
            />
            <Reading
              label="Waiting on you"
              value={counts.waiting_approval ?? 0}
              tone="warning"
              live={(counts.waiting_approval ?? 0) > 0}
            />
            <Reading label="Delivered" value={counts.completed ?? 0} tone="live" />
            <Reading
              label="Stopped"
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
            {FILTERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                className={`filter-tab${filter === entry.id ? " filter-tab-active" : ""}`}
              >
                {entry.label}
                {missions.data && (
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

        {missions.loading ? (
          <Connecting what="Fetching the company's missions…" />
        ) : missions.error ? (
          <Failure
            headline={
              missions.error.isOffline
                ? "The company is unreachable"
                : "That read failed"
            }
            detail={missions.error.message}
            consequence="Missions already on the queue keep running; this page just cannot see them."
            action={
              <button
                type="button"
                onClick={missions.reload}
                className="button-ghost"
              >
                Try again
              </button>
            }
          />
        ) : visible.length === 0 ? (
          total === 0 ? (
            <Quiet
              line="The company has never been asked for anything."
              detail="Give it an objective and every step it takes — the plan, who it went to, which tools were called, what it produced — is recorded here."
              action={
                <Link to="/missions/new" className="button-primary">
                  Open the first mission
                </Link>
              }
            />
          ) : (
            <Quiet
              line="Nothing matches that."
              detail="Try another state, or clear the search."
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
          <div className="mission-stack">
            {visible.map((mission) => {
              const workers = workersByMission.get(mission.id) ?? [];
              const plan = planOf(mission);
              const ran = formatDuration(mission.startedAt, mission.completedAt);

              return (
                <Link
                  key={mission.id}
                  to={`/missions/${mission.id}`}
                  className={`mission-entry ${toneClass[workStatusTone(mission.status)]}`}
                >
                  <span
                    className={`mission-entry-rail${mission.status === "executing" ? " op-rail-running" : ""}`}
                  />

                  <span className="min-w-0">
                    <span className="mission-entry-objective">
                      {mission.objective}
                    </span>

                    <span className="mission-entry-state block">
                      {stateLine(mission, workers)}
                    </span>

                    <span className="mission-entry-meta">
                      <span>{formatRelativeTime(mission.createdAt)}</span>

                      {workers.length > 0 && (
                        <span className="mission-entry-cast">
                          {workers.join(" · ")}
                        </span>
                      )}

                      {plan.taskCount !== undefined && (
                        <span>
                          {plan.taskCount}{" "}
                          {plan.taskCount === 1 ? "task" : "tasks"}
                        </span>
                      )}

                      {ran !== "—" && <span>ran {ran}</span>}

                      <span className="uppercase">{mission.priority}</span>
                    </span>

                    {typeof mission.metadata.executionError === "string" &&
                      !mission.metadata.interrupted && (
                        <span className="ledger-preview text-[#c9868a]">
                          {mission.metadata.executionError}
                        </span>
                      )}
                  </span>

                  <span className="mission-entry-status">
                    <StatusPill
                      tone={workStatusTone(mission.status)}
                      pulse={mission.status === "executing"}
                    >
                      {statusLabel(mission.status)}
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
