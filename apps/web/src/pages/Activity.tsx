import { Activity as ActivityIcon } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchActivity,
  formatRelativeTime,
  type ActivityEvent,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  describeEvent,
  eventCategories,
  type EventCategory,
} from "../lib/events";

import {
  EmptyState,
  PageOpening,
  Reading,
  ErrorState,
  Panel,
  Skeleton,
} from "../components/primitives";

export default function Activity() {
  const [category, setCategory] = useState<EventCategory | "all">("all");

  const activity = useResource<ActivityEvent[]>(
    useCallback(() => fetchActivity(150), []),
    { pollMs: 12_000 },
  );

  const described = useMemo(
    () =>
      (activity.data ?? []).map((event) => ({
        event,
        described: describeEvent(event),
      })),
    [activity.data],
  );

  const visible = described.filter(
    (entry) => category === "all" || entry.described.category === category,
  );

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
    <div className="mx-auto max-w-[1080px] fade-up">
      <PageOpening
        eyebrow="Intelligence"
        title="WHAT THE COMPANY"
        lead="ACTUALLY DID."
        detail="Every plan, delegation, tool call, approval and artifact, in the order it happened."
        meta={<Reading label="Recorded events" value={activity.loading ? "—" : described.length} tone="active" />}
      />

      <div className="filter-group mb-4">
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

      <Panel padded={false}>
        {activity.loading ? (
          <div className="p-[18px]">
            <Skeleton rows={9} />
          </div>
        ) : activity.error ? (
          <ErrorState
            message={activity.error.message}
            offline={activity.error.isOffline}
            onRetry={activity.reload}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={ActivityIcon}
            title={
              described.length === 0
                ? "The company has not done anything yet"
                : "Nothing in this category"
            }
            description={
              described.length === 0
                ? "Launch an objective and every step the company takes will be recorded here."
                : "Switch to another category to see the rest of the log."
            }
          />
        ) : (
          <div className="timeline timeline-wide">
            {visible.map(({ event, described: detail }) => {
              const body = (
                <>
                  <span className={`timeline-dot ${detail.tone}`} />

                  <div className="min-w-0 flex-1 pb-4">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <span className="text-[12px] text-slate-200">
                        {detail.title}
                      </span>

                      <span className="mono text-[8.5px] uppercase tracking-[0.11em] text-slate-600">
                        {detail.category}
                      </span>

                      <span className="mono ml-auto text-[9px] text-slate-600">
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </div>

                    {detail.detail && (
                      <div className="mt-1 line-clamp-2 text-[10.5px] leading-[1.6] text-slate-500">
                        {detail.detail}
                      </div>
                    )}
                  </div>
                </>
              );

              return event.workId ? (
                <Link
                  key={event.id}
                  to={`/work/${event.workId}`}
                  className="timeline-entry timeline-entry-link"
                >
                  {body}
                </Link>
              ) : (
                <div key={event.id} className="timeline-entry">
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
