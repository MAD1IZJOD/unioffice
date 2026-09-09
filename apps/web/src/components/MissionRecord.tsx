import { useMemo, useState } from "react";

import type { MissionAct, MissionMoment } from "../lib/mission";

/**
 * The record.
 *
 * The mission's event log, read back as sentences. This is the part of the
 * page that moves while you watch it, so on a wide screen it is pinned beside
 * the mission rather than buried under it.
 *
 * Newest last, deliberately. A mission is a sequence and reading it backwards
 * turns cause and effect into a shuffled list; the view is scrolled to the end
 * instead, which is where the live edge is.
 */

const ACTS: Array<{ id: MissionAct | "all"; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "strategy", label: "Strategy" },
  { id: "workforce", label: "Workforce" },
  { id: "execution", label: "Execution" },
  { id: "decisions", label: "Decisions" },
  { id: "output", label: "Output" },
];

export function MissionRecord({
  moments,
  live,
}: {
  moments: MissionMoment[];
  /** True while the mission can still add to the record. */
  live: boolean;
}) {
  const [act, setAct] = useState<MissionAct | "all">("all");

  const visible = useMemo(
    () => (act === "all" ? moments : moments.filter((m) => m.act === act)),
    [moments, act],
  );

  const available = useMemo(() => {
    const present = new Set(moments.map((moment) => moment.act));
    return ACTS.filter((entry) => entry.id === "all" || present.has(entry.id));
  }, [moments]);

  return (
    <div>
      <div className="mission-record-head">
        <span className="mission-record-title">The record</span>

        <span className="t-machine">
          {live ? "LIVE" : `${moments.length} recorded`}
        </span>
      </div>

      {available.length > 2 && (
        <div className="filter-group mt-3">
          {available.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setAct(entry.id)}
              className={`filter-tab${act === entry.id ? " filter-tab-active" : ""}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div className="mission-thread scroll-area">
        {visible.length === 0 ? (
          <p className="t-meta py-3">
            Nothing has been recorded under that heading yet.
          </p>
        ) : (
          visible.map((moment, index) => (
            <div
              key={moment.id}
              className={`mission-moment ${moment.tone}${
                index === visible.length - 1 && live
                  ? " mission-moment-latest"
                  : ""
              }`}
            >
              <span className="mission-moment-node" aria-hidden="true" />

              <p className="mission-moment-line">{moment.line}</p>

              {moment.note && (
                <p className="mission-moment-note">{moment.note}</p>
              )}

              <div className="mission-moment-foot">
                {moment.actor && (
                  <span className="mission-moment-actor">{moment.actor}</span>
                )}
                <span>{moment.when}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
