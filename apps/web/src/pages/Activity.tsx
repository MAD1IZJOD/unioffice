import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchActivity, type ActivityEvent } from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  describeEvent,
  eventCategories,
  type DescribedEvent,
  type EventCategory,
} from "../lib/events";

import {
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
} from "../components/primitives";

interface LogEntry {
  event: ActivityEvent;
  described: DescribedEvent;
}

/** The log is read by day, so it is grouped by day. */
function groupByDay(entries: LogEntry[]) {
  const groups = new Map<string, LogEntry[]>();

  for (const entry of entries) {
    const day = new Date(entry.event.timestamp).toDateString();
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  }

  return [...groups.entries()];
}

function dayLabel(day: string): string {
  const date = new Date(day);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();

  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Activity() {
  const [category, setCategory] = useState<EventCategory | "all">("all");

  const activity = useResource<ActivityEvent[]>(
    useCallback(() => fetchActivity(150), []),
    { pollMs: 12_000 },
  );

  const described = useMemo<LogEntry[]>(
    () =>
      (activity.data ?? []).map((event) => ({
        event,
        described: describeEvent(event),
      })),
    [activity.data],
  );

  const visible = useMemo(
    () =>
      described.filter(
        (entry) => category === "all" || entry.described.category === category,
      ),
    [described, category],
  );

  const days = useMemo(() => groupByDay(visible), [visible]);

  const counts = useMemo(
    () =>
      described.reduce<Record<string, number>>((totals, entry) => {
        totals.all = (totals.all ?? 0) + 1;
        totals[entry.described.category] =
          (totals[entry.described.category] ?? 0) + 1;
        return totals;
      }, {}),
    [described],
  );

  return (
    <div className="mx-auto max-w-[1000px] fade-up">
      <PageOpening
        eyebrow="Brain"
        title="WHAT THE COMPANY"
        lead="ACTUALLY DID."
        detail="Every plan, delegation, tool call, approval and artifact, in the order it happened. This is the record the rest of the product is derived from."
        meta={
          <>
            <Reading
              label="Recorded"
              value={activity.loading ? "—" : described.length}
              tone="active"
            />
            <Reading
              label="Tool calls"
              value={activity.loading ? "—" : (counts.tool ?? 0)}
              tone="idle"
            />
            <Reading
              label="Decisions"
              value={activity.loading ? "—" : (counts.approval ?? 0)}
              tone="warning"
            />
          </>
        }
      />

      <div className="filter-group mb-1">
        {eventCategories.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setCategory(entry.id)}
            className={`filter-tab${category === entry.id ? " filter-tab-active" : ""}`}
          >
            {entry.label}
            {activity.data && (
              <span className="filter-count">{counts[entry.id] ?? 0}</span>
            )}
          </button>
        ))}
      </div>

      {activity.loading ? (
        <Connecting what="Reading the company log…" />
      ) : activity.error ? (
        <Failure
          headline={
            activity.error.isOffline
              ? "The company is unreachable"
              : "The log could not be read"
          }
          detail={activity.error.message}
          action={
            <button
              type="button"
              onClick={activity.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      ) : visible.length === 0 ? (
        described.length === 0 ? (
          <Quiet
            line="Nothing has happened yet."
            detail="Launch an objective and every step the company takes — planning, delegation, each tool call, each decision — is written here as it happens."
            action={
              <Link to="/command" className="button-primary">
                Go to the Command Center
              </Link>
            }
          />
        ) : (
          <Quiet
            line="Nothing in this category."
            detail="The rest of the log is still there."
            action={
              <button
                type="button"
                className="button-ghost"
                onClick={() => setCategory("all")}
              >
                Show everything
              </button>
            }
          />
        )
      ) : (
        days.map(([day, entries]) => (
          <section key={day}>
            <div className="log-day">
              <span className="log-day-name">{dayLabel(day)}</span>
              <span className="log-day-rule" />
              <span className="log-day-count">
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            {entries.map(({ event, described: detail }) => {
              const body = (
                <>
                  <span className="log-time">{clockTime(event.timestamp)}</span>

                  <span className={`log-dot ${detail.tone}`} />

                  <span className="min-w-0">
                    <span className="log-title">{detail.title}</span>

                    {detail.detail && (
                      <span className="log-detail">{detail.detail}</span>
                    )}
                  </span>
                </>
              );

              return event.workId ? (
                <Link
                  key={event.id}
                  to={`/missions/${event.workId}`}
                  className="log-entry"
                >
                  {body}
                </Link>
              ) : (
                <div key={event.id} className="log-entry">
                  {body}
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
