import { Search } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMemory, formatRelativeTime, type MemoryItem } from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  Chip,
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
} from "../components/primitives";

import type { Tone } from "../lib/tone";

const typeTone: Record<string, Tone> = {
  decision: "warning",
  fact: "live",
  experience: "active",
  instruction: "idle",
  preference: "idle",
  document: "idle",
};

/** What each kind of memory is, in the company's own terms. */
const typeMeaning: Record<string, string> = {
  experience: "a task that completed, and what it produced",
  decision: "a task that failed, and why",
  fact: "something established about the company",
  instruction: "a standing instruction",
  preference: "a stated preference",
  document: "a stored document",
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

  const byType = useMemo(
    () =>
      memories.reduce<Record<string, number>>((totals, item) => {
        totals[item.type] = (totals[item.type] ?? 0) + 1;
        return totals;
      }, {}),
    [memories],
  );

  const heaviest = useMemo(
    () =>
      [...memories]
        .sort((left, right) => right.importance - left.importance)
        .slice(0, 5),
    [memories],
  );

  return (
    <div className="mx-auto max-w-[1180px] fade-up">
      <PageOpening
        eyebrow="Intelligence"
        title="THE COMPANY"
        lead="REMEMBERS."
        detail="Every completed and failed task writes here, and an agent retrieves from it before starting related work. Retrieval is keyword and importance based — there are no embeddings behind this yet."
        meta={
          <>
            <Reading
              label={submitted ? "Recalled" : "Stored"}
              value={memory.loading ? "—" : memories.length}
              tone="active"
            />
            <Reading
              label="From failures"
              value={memory.loading ? "—" : (byType.decision ?? 0)}
              tone="warning"
            />
            <Reading
              label="From outcomes"
              value={memory.loading ? "—" : (byType.experience ?? 0)}
              tone="live"
            />
          </>
        }
      />

      <form
        className="mb-1 flex flex-wrap items-center gap-2"
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

      {submitted && !memory.loading && (
        <p className="mb-4 mt-3 max-w-[70ch] text-[11.5px] leading-[1.7] text-[#6f7887]">
          {memories.length === 0
            ? `Nothing was recalled for “${submitted}”.`
            : `This is what an agent would be handed if it started work on “${submitted}” — the same retriever, the same ranking.`}
        </p>
      )}

      <div className="grid gap-9 xl:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0">
          {memory.loading ? (
            <Connecting what="Recalling company memory…" />
          ) : memory.error ? (
            <Failure
              headline={
                memory.error.isOffline
                  ? "The company is unreachable"
                  : "Memory could not be read"
              }
              detail={memory.error.message}
              action={
                <button
                  type="button"
                  onClick={memory.reload}
                  className="button-ghost"
                >
                  Try again
                </button>
              }
            />
          ) : memories.length === 0 ? (
            <Quiet
              line={
                submitted
                  ? "Nothing was recalled."
                  : "The company hasn't learned anything yet."
              }
              detail={
                submitted
                  ? "No stored memory matched that closely enough to be retrieved. An agent starting this work would begin from the objective alone."
                  : "Memory accumulates on its own as work completes. Run an objective and its outcome is written here."
              }
              action={
                submitted ? undefined : (
                  <Link to="/command" className="button-primary">
                    Give the company an objective
                  </Link>
                )
              }
            />
          ) : (
            <div className="archive">
              {memories.map((item, index) => (
                <MemoryEntry
                  key={item.id}
                  memory={item}
                  index={index}
                  recalled={Boolean(submitted)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <div className="section-head">
            <div className="section-head-title">Weighted highest</div>
          </div>

          {heaviest.length === 0 ? (
            <p className="t-meta py-2">
              Importance is set when a memory is written — a failure is stored
              heavier than a success, because it is what the company most needs
              to not repeat.
            </p>
          ) : (
            <div className="space-y-px">
              {heaviest.map((item) => (
                <div key={item.id} className="py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <Chip tone={typeTone[item.type] ?? "idle"}>
                      {item.type}
                    </Chip>

                    <span className="mono text-[9px] text-[#535b68]">
                      {(item.importance * 100).toFixed(0)}%
                    </span>
                  </div>

                  <p className="mt-2 line-clamp-3 text-[11px] leading-[1.65] text-[#6f7887]">
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

          <div className="mt-8">
            <div className="section-head">
              <div className="section-head-title">What is in here</div>
            </div>

            <dl className="space-y-3">
              {Object.entries(byType)
                .sort((left, right) => right[1] - left[1])
                .map(([type, count]) => (
                  <div key={type} className="flex items-baseline gap-3">
                    <dt className="w-[86px] shrink-0">
                      <Chip tone={typeTone[type] ?? "idle"}>{type}</Chip>
                    </dt>
                    <dd className="min-w-0 flex-1 text-[10.5px] leading-[1.6] text-[#6f7887]">
                      {typeMeaning[type] ?? "stored context"}
                    </dd>
                    <dd className="mono shrink-0 text-[10px] text-[#a7b0bd]">
                      {count}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MemoryEntry({
  memory,
  index,
  recalled,
}: {
  memory: MemoryItem;
  index: number;
  recalled: boolean;
}) {
  // Memories are written as `Task "X" completed: summary`, so the sentence
  // before the colon is the headline and the rest is the body.
  const separator = memory.content.indexOf(": ");
  const title =
    separator === -1 ? memory.content : memory.content.slice(0, separator);
  const detail = separator === -1 ? "" : memory.content.slice(separator + 2);

  return (
    <article
      className={`memory-entry${recalled ? " recalled" : ""}`}
      style={{ "--recall-index": index } as React.CSSProperties}
    >
      <div className="memory-margin">
        <div className="memory-when">
          {formatRelativeTime(memory.createdAt)}
        </div>
        <div className="memory-weight">
          {(memory.importance * 100).toFixed(0)}%
        </div>
      </div>

      <div className="min-w-0">
        <div className="memory-title">{title}</div>

        {detail && <p className="memory-detail">{detail}</p>}

        <div className="memory-foot">
          <Chip tone={typeTone[memory.type] ?? "idle"}>{memory.type}</Chip>
          <Chip tone="idle">{memory.scope}</Chip>

          {memory.workId && (
            <Link to={`/work/${memory.workId}`} className="button-quiet">
              The work that produced this
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
