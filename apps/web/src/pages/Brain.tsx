import { Plus, Search } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  approveKnowledge,
  archiveKnowledge,
  createKnowledge,
  fetchAgents,
  fetchKnowledgeOverview,
  fetchWorkspaces,
  formatRelativeTime,
  previewRecall,
  resolveKnowledgeConflict,
  restoreKnowledge,
  searchKnowledge,
  type AgentSummary,
  type KnowledgeFilters,
  type KnowledgeOverview,
  type KnowledgeSearchResponse,
  type KnowledgeSourceType,
  type KnowledgeStatus,
  type KnowledgeType,
  type RecallPreview as RecallPreviewData,
  type WorkspaceSummary,
} from "../lib/api";

import {
  daysAgoIso,
  KNOWLEDGE_KINDS,
  kindLabel,
  sourceLabel,
} from "../lib/knowledge";

import { useResource } from "../lib/useResource";

import { Connecting, Failure, Quiet } from "../components/primitives";

import { ConflictPair, type ConflictDecision } from "../components/brain/ConflictPair";
import { KnowledgeComposer } from "../components/brain/KnowledgeComposer";
import { KnowledgeRow } from "../components/brain/KnowledgeRow";
import { RecallPreview } from "../components/brain/RecallPreview";

/**
 * The Company Brain.
 *
 * What the company knows, what it learned recently, what it stands on, what
 * it is still deciding, what it is using and what it disagrees with - each
 * read from the backend, none of it estimated here.
 *
 * Two ways in. Searching the Brain is a person looking across the whole
 * organization. Previewing recall is asking what an agent would actually be
 * handed for a piece of work - the same recall execution runs, with the
 * workspace boundary and governance applied, only not recorded.
 */

type Mode = "search" | "recall";
type StatusFilter = "current" | "proposed" | "archived" | "all";

const PAGE = 20;

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string; statuses: KnowledgeStatus[] }> = [
  { value: "current", label: "Current", statuses: ["active"] },
  { value: "proposed", label: "Proposed", statuses: ["proposed"] },
  { value: "all", label: "Current and proposed", statuses: ["active", "proposed"] },
  { value: "archived", label: "Archived", statuses: ["archived"] },
];

const SOURCES: KnowledgeSourceType[] = ["task", "artifact", "user", "approval", "agent"];

const SINCE: Array<{ days?: number; label: string }> = [
  { label: "Any time" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export default function Brain() {
  const [mode, setMode] = useState<Mode>("search");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");

  const [types, setTypes] = useState<KnowledgeType[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [reach, setReach] = useState("");
  const [source, setSource] = useState<KnowledgeSourceType | "">("");
  const [importantOnly, setImportantOnly] = useState(false);
  const [sinceDays, setSinceDays] = useState<number>();
  const [page, setPage] = useState(0);

  const [recallWorkspace, setRecallWorkspace] = useState("");
  const [recallAgent, setRecallAgent] = useState("");

  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composeError, setComposeError] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  const overview = useResource<KnowledgeOverview>(
    useCallback(() => fetchKnowledgeOverview(), []),
    { pollMs: 30_000 },
  );
  const workspaces = useResource<WorkspaceSummary[]>(useCallback(() => fetchWorkspaces(), []));
  const agents = useResource<AgentSummary[]>(useCallback(() => fetchAgents(), []));

  const filtered =
    types.length > 0 || status !== "all" || reach !== "" || source !== "" || importantOnly || sinceDays !== undefined;

  // The timestamp is taken once per filter choice, not per render, so the
  // loader stays stable and the request is not re-issued every paint.
  const createdAfter = useMemo(
    () => (sinceDays === undefined ? undefined : daysAgoIso(sinceDays)),
    [sinceDays],
  );

  const filters: KnowledgeFilters = useMemo(
    () => ({
      query: query || undefined,
      types,
      statuses: STATUS_FILTERS.find((entry) => entry.value === status)!.statuses,
      workspaceId: reach || undefined,
      sourceType: source || undefined,
      minImportance: importantOnly ? 0.7 : undefined,
      createdAfter,
      limit: PAGE,
      offset: page * PAGE,
    }),
    [query, types, status, reach, source, importantOnly, createdAfter, page],
  );

  const results = useResource<KnowledgeSearchResponse>(
    useCallback(() => searchKnowledge(filters), [filters]),
    { enabled: mode === "search" && (Boolean(query) || filtered) },
  );

  const recall = useResource<RecallPreviewData>(
    useCallback(
      () => previewRecall({ query, workspaceId: recallWorkspace, agentId: recallAgent }),
      [query, recallWorkspace, recallAgent],
    ),
    { enabled: mode === "recall" && Boolean(query) },
  );

  const workspaceName = useCallback(
    (id?: string) => workspaces.data?.find((entry) => entry.workspace.id === id)?.workspace.name,
    [workspaces.data],
  );

  const { reload: reloadOverview } = overview;
  const { reload: reloadResults } = results;

  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);

    try {
      await operation();
      reloadOverview();
      if (mode === "search" && (query || filtered)) reloadResults();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function record(input: Parameters<typeof createKnowledge>[0]) {
    setBusy(true);
    setComposeError(undefined);

    try {
      await createKnowledge(input);
      setComposing(false);
      reloadOverview();
    } catch (error) {
      setComposeError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const decide = (conflictId: string, decision: ConflictDecision) =>
    act(() => resolveKnowledgeConflict(conflictId, decision));

  const data = overview.data;
  const counts = data?.counts;
  const asking = mode === "search" ? Boolean(query) || filtered : Boolean(query);

  function toggleType(type: KnowledgeType) {
    setPage(0);
    setTypes((current) =>
      current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type],
    );
  }

  return (
    <div className="brain fade-up">
      <header className={`brain-open${data?.retrieval.semantic ? " brain-open-semantic" : ""}`}>
        <div className="brain-open-inner">
          <div className="brain-eyebrow">
            <span>Company Brain</span>
            {data && (
              <span className={data.retrieval.semantic ? "brain-eyebrow-live" : undefined}>
                {data.retrieval.semantic
                  ? `Semantic recall · ${data.retrieval.embeddingModel} on this machine`
                  : "Keyword recall · no embedding model configured"}
              </span>
            )}
          </div>

          <h2 className="brain-statement">
            <span className="brain-statement-line">What the company</span>
            <span className="brain-statement-line">knows.</span>
            <span className="brain-statement-line brain-statement-quiet">And where it learned it.</span>
          </h2>

          <p className="brain-lead">
            Before Tyrion writes a plan and before any agent starts a step, the company recalls what
            it already knows about the work — within the workspace it runs in, through the same
            policies as everything else. What an agent learns is proposed here, not trusted: a
            person decides what becomes current.
          </p>

          <div className="brain-readout">
            <Reading label="Current" value={counts?.active} tone="blue" />
            <Reading label="Proposed" value={counts?.proposed} tone={counts?.proposed ? "amber" : undefined} />
            <Reading label="Conflicting" value={counts?.openConflicts} tone={counts?.openConflicts ? "red" : undefined} />
            <Reading label="Missions informed" value={counts?.missionsInformed} />
            <Reading label="May be outdated" value={counts?.stale} tone={counts?.stale ? "amber" : undefined} />
            <Reading label="Archived" value={counts?.archived} />
          </div>
        </div>
      </header>

      <div className="brain-body">
        <section className="brain-query">
          <div className="brain-modes" role="group" aria-label="What to ask">
            <button type="button" className="brain-mode" aria-pressed={mode === "search"} onClick={() => setMode("search")}>
              Search the Brain
            </button>
            <button type="button" className="brain-mode" aria-pressed={mode === "recall"} onClick={() => setMode("recall")}>
              What would an agent be handed?
            </button>
            <button
              type="button"
              className="brain-mode ml-auto"
              aria-pressed={composing}
              onClick={() => setComposing((value) => !value)}
            >
              <Plus size={12} className="mr-1 inline" />
              Record knowledge
            </button>
          </div>

          <form
            className="brain-query-row"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setQuery(draft.trim());
            }}
          >
            <label className="brain-query-field">
              <Search size={17} className="text-[#535b68]" />
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={500}
                placeholder={
                  mode === "search"
                    ? "Ask what the company knows about pricing, a customer, a decision…"
                    : "Describe the work — “Create a revised pricing strategy”"
                }
                aria-label={mode === "search" ? "Search company knowledge" : "Describe work to preview recall"}
              />
            </label>

            <div className="flex gap-2">
              <button type="submit" className="button-primary">
                {mode === "search" ? "Search" : "Preview recall"}
              </button>
              {(query || draft) && (
                <button
                  type="button"
                  className="button-quiet"
                  onClick={() => {
                    setDraft("");
                    setQuery("");
                    setPage(0);
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {mode === "recall" ? (
            <div className="brain-scope">
              <select className="brain-select" value={recallWorkspace} onChange={(event) => setRecallWorkspace(event.target.value)} aria-label="Workspace the work runs in">
                <option value="">Work outside any workspace</option>
                {(workspaces.data ?? []).map((entry) => (
                  <option key={entry.workspace.id} value={entry.workspace.id}>
                    Work in {entry.workspace.name}
                  </option>
                ))}
              </select>

              <select className="brain-select" value={recallAgent} onChange={(event) => setRecallAgent(event.target.value)} aria-label="Agent doing the work">
                <option value="">Any agent</option>
                {(agents.data ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    As {agent.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="brain-filters">
              <div className="brain-filter-group">
                <span className="brain-filter-label">Kind</span>
                {KNOWLEDGE_KINDS.filter((kind) => kind.type !== "experience").map((kind) => (
                  <button key={kind.type} type="button" className="brain-filter" aria-pressed={types.includes(kind.type)} onClick={() => toggleType(kind.type)}>
                    {kind.label}
                  </button>
                ))}
              </div>

              <div className="brain-filter-group">
                <span className="brain-filter-label">Standing</span>
                {STATUS_FILTERS.map((entry) => (
                  <button
                    key={entry.value}
                    type="button"
                    className="brain-filter"
                    aria-pressed={status === entry.value}
                    onClick={() => {
                      setPage(0);
                      setStatus(entry.value);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              <div className="brain-filter-group">
                <span className="brain-filter-label">Recorded</span>
                {SINCE.map((entry) => (
                  <button
                    key={entry.label}
                    type="button"
                    className="brain-filter"
                    aria-pressed={sinceDays === entry.days}
                    onClick={() => {
                      setPage(0);
                      setSinceDays(entry.days);
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="brain-filter"
                  aria-pressed={importantOnly}
                  onClick={() => {
                    setPage(0);
                    setImportantOnly((value) => !value);
                  }}
                >
                  Important only
                </button>
              </div>

              <div className="brain-filter-group">
                <select className="brain-select" value={reach} onChange={(event) => { setPage(0); setReach(event.target.value); }} aria-label="Where it applies">
                  <option value="">Everywhere</option>
                  <option value="company">Company-wide only</option>
                  {(workspaces.data ?? []).map((entry) => (
                    <option key={entry.workspace.id} value={entry.workspace.id}>
                      Only {entry.workspace.name}
                    </option>
                  ))}
                </select>

                <select className="brain-select" value={source} onChange={(event) => { setPage(0); setSource(event.target.value as KnowledgeSourceType | ""); }} aria-label="Where it came from">
                  <option value="">Any source</option>
                  {SOURCES.map((entry) => (
                    <option key={entry} value={entry}>
                      {sourceLabel(entry)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>

        {composing && (
          <div className="mt-6">
            <KnowledgeComposer
              workspaces={workspaces.data ?? []}
              busy={busy}
              error={composeError}
              onCancel={() => setComposing(false)}
              onCreate={(input) => void record(input)}
            />
          </div>
        )}

        {actionError && (
          <div className="mt-5">
            <Failure headline="That change was not made" detail={actionError} consequence="The Brain is exactly as it was." />
          </div>
        )}

        {asking ? (
          mode === "recall" ? (
            recall.loading ? (
              <Connecting what="Recalling the way an agent would…" />
            ) : recall.error ? (
              <Failure headline="Recall could not be previewed" detail={recall.error.message} />
            ) : recall.data ? (
              <RecallPreview preview={recall.data} query={query} />
            ) : null
          ) : (
            <SearchResults
              results={results}
              query={query}
              page={page}
              onPage={setPage}
              workspaceName={workspaceName}
              busy={busy}
              onApprove={(id) => void act(() => approveKnowledge(id))}
              onArchive={(id) => void act(() => archiveKnowledge(id, "Archived from the Brain."))}
              onRestore={(id) => void act(() => restoreKnowledge(id))}
            />
          )
        ) : overview.loading ? (
          <Connecting what="Reading what the company knows…" />
        ) : overview.error ? (
          <div className="mt-6">
            <Failure
              headline={overview.error.isOffline ? "The Brain is unreachable" : "The Brain could not be read"}
              detail={overview.error.message}
              consequence="Recall during planning and execution does not depend on this page."
              action={<button type="button" onClick={overview.reload} className="button-ghost">Try again</button>}
            />
          </div>
        ) : data ? (
          <Strata
            data={data}
            busy={busy}
            workspaceName={workspaceName}
            onDecide={decide}
            onApprove={(id) => void act(() => approveKnowledge(id))}
            onArchive={(id) => void act(() => archiveKnowledge(id, "Archived during review."))}
          />
        ) : null}
      </div>
    </div>
  );
}

function Reading({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | undefined;
  tone?: "blue" | "red" | "amber";
}) {
  return (
    <div className={`brain-reading${tone ? ` brain-reading-${tone}` : ""}`}>
      <div className="brain-reading-value">{value ?? "—"}</div>
      <div className="brain-reading-label">{label}</div>
    </div>
  );
}

function SearchResults({
  results,
  query,
  page,
  onPage,
  workspaceName,
  busy,
  onApprove,
  onArchive,
  onRestore,
}: {
  results: ReturnType<typeof useResource<KnowledgeSearchResponse>>;
  query: string;
  page: number;
  onPage: (page: number) => void;
  workspaceName: (id?: string) => string | undefined;
  busy: boolean;
  onApprove: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
}) {
  if (results.loading) return <Connecting what="Searching what the company knows…" />;

  if (results.error) {
    return (
      <div className="mt-6">
        <Failure headline="The search did not complete" detail={results.error.message} />
      </div>
    );
  }

  const items = results.data?.items ?? [];

  return (
    <section className="mt-2">
      <p className="brain-answer-note">
        {items.length === 0
          ? query
            ? `Nothing the company knows matched “${query}” closely enough to be retrieved.`
            : "No knowledge matches these filters."
          : results.data?.mode === "relevance"
            ? `Ranked by relevance to “${query}”: meaning, shared terms, importance, recency, where it applies and how it was sourced. The reasons under each entry are the ranker’s own.`
            : "Newest first."}
      </p>

      {items.length > 0 && (
        <div className="knowledge-list mt-4">
          {items.map((result, index) => (
            <KnowledgeRow
              key={result.knowledge.id}
              item={result.knowledge}
              result={result}
              index={index}
              animate={results.data?.mode === "relevance"}
              workspaceName={workspaceName(result.knowledge.workspaceId)}
              actions={
                result.knowledge.status === "proposed" ? (
                  <>
                    <button type="button" className="button-ghost" disabled={busy} onClick={() => onApprove(result.knowledge.id)}>Approve</button>
                    <button type="button" className="button-quiet" disabled={busy} onClick={() => onArchive(result.knowledge.id)}>Archive</button>
                  </>
                ) : result.knowledge.status === "archived" ? (
                  <button type="button" className="button-quiet" disabled={busy} onClick={() => onRestore(result.knowledge.id)}>Restore</button>
                ) : undefined
              }
            />
          ))}
        </div>
      )}

      {(page > 0 || items.length === PAGE) && (
        <div className="mt-5 flex gap-2">
          <button type="button" className="button-quiet" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
          <button type="button" className="button-quiet" disabled={items.length < PAGE} onClick={() => onPage(page + 1)}>Next</button>
        </div>
      )}
    </section>
  );
}

function Strata({
  data,
  busy,
  workspaceName,
  onDecide,
  onApprove,
  onArchive,
}: {
  data: KnowledgeOverview;
  busy: boolean;
  workspaceName: (id?: string) => string | undefined;
  onDecide: (conflictId: string, decision: ConflictDecision) => void;
  onApprove: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const nothing = data.counts.active + data.counts.proposed + data.counts.archived === 0;

  if (nothing) {
    return (
      <div className="mt-8">
        <Quiet
          line="The company hasn't learned anything yet."
          detail="Knowledge is proposed when a mission produces something durable, and recorded when a person writes it down. Nothing is invented to fill this page."
          action={<Link to="/command" className="button-primary">Give the company an objective</Link>}
        />
      </div>
    );
  }

  const largestKind = Math.max(1, ...Object.values(data.byType).map((value) => value ?? 0));

  return (
    <div className="brain-strata">
      <div className="min-w-0">
        {data.conflicts.length > 0 && (
          <section className="stratum stratum-red">
            <div className="stratum-head">
              <span className="stratum-name">Conflicting</span>
              <span className="stratum-count">{data.conflicts.length}</span>
              <span className="stratum-note">The company will not choose between these on its own</span>
            </div>
            {data.conflicts.map((entry) => (
              <ConflictPair
                key={entry.conflict.id}
                conflict={entry.conflict}
                left={entry.left}
                right={entry.right}
                busy={busy}
                onDecide={(decision) => onDecide(entry.conflict.id, decision)}
              />
            ))}
          </section>
        )}

        {data.awaitingReview.length > 0 && (
          <section className="stratum stratum-amber">
            <div className="stratum-head">
              <span className="stratum-name">Proposed</span>
              <span className="stratum-count">{data.counts.proposed}</span>
              <span className="stratum-note">Recalled only as unverified leads until approved</span>
            </div>
            <div className="knowledge-list">
              {data.awaitingReview.map((item) => (
                <KnowledgeRow
                  key={item.id}
                  item={item}
                  workspaceName={workspaceName(item.workspaceId)}
                  actions={
                    <>
                      <button type="button" className="button-ghost" disabled={busy} onClick={() => onApprove(item.id)}>Approve</button>
                      <button type="button" className="button-quiet" disabled={busy} onClick={() => onArchive(item.id)}>Archive</button>
                    </>
                  }
                />
              ))}
            </div>
          </section>
        )}

        <section className="stratum">
          <div className="stratum-head">
            <span className="stratum-name">Recently learned</span>
            <span className="stratum-count">{data.recentlyLearned.length}</span>
          </div>
          {data.recentlyLearned.map((item) => (
            <div key={item.id} className="learned-line">
              <div className="learned-when">{formatRelativeTime(item.createdAt)}</div>
              <div className="min-w-0">
                <Link to={`/brain/${item.id}`} className="learned-title">{item.title}</Link>
                <div className="learned-source">
                  {kindLabel(item.type)} · {sourceLabel(item.sourceType)}
                  {item.workId && (
                    <>
                      {" · "}
                      <Link to={`/missions/${item.workId}`} className="hover:text-[#84b4fb]">the mission</Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>

      <aside className="min-w-0">
        <section className="stratum stratum-blue">
          <div className="stratum-head">
            <span className="stratum-name">In context</span>
            <span className="stratum-count">{data.counts.missionsInformed} missions</span>
          </div>
          {data.inUse.length === 0 ? (
            <p className="t-meta py-3">No mission has been handed company knowledge yet.</p>
          ) : (
            data.inUse.map((entry) => (
              <div key={entry.knowledge.id} className="learned-line">
                <div className="learned-when in-use-count">×{entry.recallCount}</div>
                <div className="min-w-0">
                  <Link to={`/brain/${entry.knowledge.id}`} className="learned-title">{entry.knowledge.title}</Link>
                  <div className="learned-source">
                    recalled into {entry.missionCount} {entry.missionCount === 1 ? "mission" : "missions"} · last{" "}
                    {formatRelativeTime(entry.lastRecalledAt)}
                  </div>
                </div>
              </div>
            ))
          )}
        </section>

        {data.important.length > 0 && (
          <section className="stratum">
            <div className="stratum-head">
              <span className="stratum-name">Important</span>
              <span className="stratum-count">{data.important.length}</span>
            </div>
            {data.important.map((item) => (
              <div key={item.id} className="learned-line">
                <div className="learned-when">{Math.round(item.importance * 100)}</div>
                <div className="min-w-0">
                  <Link to={`/brain/${item.id}`} className="learned-title">{item.title}</Link>
                  <div className="learned-source">{kindLabel(item.type)}</div>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="stratum">
          <div className="stratum-head">
            <span className="stratum-name">Made of</span>
            <span className="stratum-note">
              {data.byTypeSampleSize === 200 ? "newest 200 entries" : `${data.byTypeSampleSize} entries`}
            </span>
          </div>
          <ul className="kind-bars">
            {KNOWLEDGE_KINDS.filter((kind) => data.byType[kind.type]).map((kind) => (
              <li key={kind.type} className="kind-bar">
                <span className="kind-bar-label">{kind.label}</span>
                <span className="kind-bar-track">
                  <span className="kind-bar-fill" style={{ display: "block", width: `${((data.byType[kind.type] ?? 0) / largestKind) * 100}%` }} />
                </span>
                <span className="kind-bar-value">{data.byType[kind.type]}</span>
              </li>
            ))}
          </ul>
        </section>

        {data.archived.length > 0 && (
          <section className="stratum">
            <div className="stratum-head">
              <span className="stratum-name">Archived</span>
              <span className="stratum-count">{data.counts.archived}</span>
              <span className="stratum-note">Kept for history, never recalled</span>
            </div>
            {data.archived.map((item) => (
              <div key={item.id} className="learned-line">
                <div className="learned-when">{formatRelativeTime(item.archivedAt ?? item.updatedAt)}</div>
                <div className="min-w-0">
                  <Link to={`/brain/${item.id}`} className="learned-title">{item.title}</Link>
                  {typeof item.metadata.archivedReason === "string" && (
                    <div className="learned-source">{item.metadata.archivedReason}</div>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}
