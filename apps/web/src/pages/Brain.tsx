import { Brain as BrainIcon, Search } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchMemory,
  formatRelativeTime,
  type MemoryItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chip,
  EmptyState,
  ErrorState,
  Metric,
  Panel,
  Readout,
  SectionHeading,
  Skeleton,
} from "../components/primitives";

const typeTone: Record<string, "live" | "active" | "warning" | "idle"> = {
  decision: "warning",
  fact: "live",
  experience: "active",
  instruction: "idle",
  preference: "idle",
  document: "idle",
};

export default function Brain() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  // Retrieval runs server-side through the same memory retriever the agents
  // use, so what the page shows is genuinely what an agent would recall for
  // that query - not a client-side substring filter over a fetched page.
  const memory = useResource<MemoryItem[]>(
    useCallback(() => fetchMemory(submitted || undefined, 80), [submitted]),
    { pollMs: 30_000 },
  );

  const memories = useMemo(() => memory.data ?? [], [memory.data]);

  const important = useMemo(
    () =>
      [...memories]
        .sort((left, right) => right.importance - left.importance)
        .slice(0, 5),
    [memories],
  );

  const byType = useMemo(
    () =>
      memories.reduce<Record<string, number>>((totals, item) => {
        totals[item.type] = (totals[item.type] ?? 0) + 1;
        return totals;
      }, {}),
    [memories],
  );

  return (
    <div className="mx-auto max-w-[1180px] fade-up">
      <SectionHeading
        title="Company Brain"
        description="Organizational memory. Every completed and failed task writes here, and agents retrieve from it before starting related work."
      />

      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <label className="search-field flex-1">
          <Search size={13} className="text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Recall what the company knows about…"
            aria-label="Search company memory"
          />
        </label>

        <button type="submit" className="button-ghost">
          Recall
        </button>

        {submitted && (
          <button
            type="button"
            className="button-quiet"
            onClick={() => {
              setQuery("");
              setSubmitted("");
            }}
          >
            Clear
          </button>
        )}
      </form>

      <div className="mb-5">
        <Readout>
        <Metric
          label="Memories"
          tone="live"
          value={memory.loading ? "—" : memories.length}
          detail={submitted ? `recalled for “${submitted}”` : "in the company brain"}
        />

        <Metric
          label="Decisions"
          tone="warning"
          value={memory.loading ? "—" : (byType.decision ?? 0)}
          detail="Choices the company has made"
        />

        <Metric
          label="Experience"
          tone="active"
          value={memory.loading ? "—" : (byType.experience ?? 0)}
          detail="Outcomes recorded from real tasks"
        />
        </Readout>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel
          eyebrow={submitted ? "Retrieved" : "Recent"}
          title={
            submitted
              ? `What the company recalls about “${submitted}”`
              : "What the company knows"
          }
          padded={false}
        >
          {memory.loading ? (
            <div className="p-[18px]">
              <Skeleton rows={6} />
            </div>
          ) : memory.error ? (
            <ErrorState
              message={memory.error.message}
              offline={memory.error.isOffline}
              onRetry={memory.reload}
            />
          ) : memories.length === 0 ? (
            <EmptyState
              icon={BrainIcon}
              title={
                submitted
                  ? "Nothing relevant was recalled"
                  : "The company brain is empty"
              }
              description={
                submitted
                  ? "No stored memory matched that query closely enough to be retrieved."
                  : "Memories accumulate automatically as work completes. Run an objective and its outcome will be recorded here."
              }
            />
          ) : (
            <div className="stack-list">
              {memories.map((item) => (
                <MemoryRow key={item.id} memory={item} />
              ))}
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="Signal"
          title="Highest importance"
          className="self-start"
          padded={false}
        >
          {important.length === 0 ? (
            <EmptyState
              icon={BrainIcon}
              title="Nothing weighted yet"
              description="Importance rises as memories are written and retrieved."
            />
          ) : (
            <div className="stack-list">
              {important.map((item) => (
                <div key={item.id} className="px-[18px] py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <Chip tone={typeTone[item.type] ?? "idle"}>{item.type}</Chip>

                    <span className="mono text-[9px] text-slate-600">
                      {(item.importance * 100).toFixed(0)}%
                    </span>
                  </div>

                  <p className="mt-2 line-clamp-3 text-[11px] leading-[1.6] text-slate-400">
                    {item.content}
                  </p>

                  <div className="importance-track mt-2.5">
                    <div
                      className="importance-fill"
                      style={{ width: `${Math.round(item.importance * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function MemoryRow({ memory }: { memory: MemoryItem }) {
  const separator = memory.content.indexOf(": ");
  const title =
    separator === -1 ? memory.content : memory.content.slice(0, separator);
  const detail = separator === -1 ? "" : memory.content.slice(separator + 2);

  return (
    <div className="px-[18px] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={typeTone[memory.type] ?? "idle"}>{memory.type}</Chip>

        <Chip tone="idle">{memory.scope}</Chip>

        <span className="mono ml-auto text-[9px] text-slate-600">
          {formatRelativeTime(memory.createdAt)}
        </span>
      </div>

      <div className="mt-2.5 text-[12px] font-semibold leading-[1.55] text-slate-200">
        {title}
      </div>

      {detail && (
        <p className="mt-1.5 text-[11px] leading-[1.7] text-slate-500">
          {detail}
        </p>
      )}

      {memory.workId && (
        <Link
          to={`/work/${memory.workId}`}
          className="button-quiet mt-2.5 inline-flex"
        >
          Open the work that produced this
        </Link>
      )}
    </div>
  );
}
