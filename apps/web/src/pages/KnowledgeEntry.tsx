import { ArrowLeft } from "lucide-react";

import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import {
  approveKnowledge,
  archiveKnowledge,
  fetchKnowledgeDetail,
  fetchWorkspaces,
  formatRelativeTime,
  resolveKnowledgeConflict,
  restoreKnowledge,
  updateKnowledge,
  type KnowledgeDetail,
  type KnowledgeType,
  type WorkspaceSummary,
} from "../lib/api";

import {
  actorLabel,
  flagSentence,
  importanceWord,
  kindLabel,
  kindMeaning,
  knowledgeStatusLabel,
  knowledgeStatusTone,
  percent,
  reachLabel,
  sourceLabel,
  WRITABLE_KINDS,
} from "../lib/knowledge";

import { useCan } from "../lib/access";
import { useResource } from "../lib/useResource";

import { Chip, Connecting, Failure } from "../components/primitives";

import { ConflictPair } from "../components/brain/ConflictPair";
import { KnowledgeRow } from "../components/brain/KnowledgeRow";
import { ProvenanceTrail } from "../components/brain/ProvenanceTrail";

/**
 * One piece of company knowledge, opened.
 *
 * What it says, why it matters, where it came from, who stands behind it,
 * where it applies, what it has been used for and what it disagrees with. The
 * page states only what the record holds: a rationale appears when extraction
 * recorded one, a mission is named when the backend confirmed it, and nothing
 * is filled in to make the page look complete.
 */
export default function KnowledgeEntry() {
  const { knowledgeId = "" } = useParams();

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [editing, setEditing] = useState(false);

  const detail = useResource<KnowledgeDetail>(
    useCallback(() => fetchKnowledgeDetail(knowledgeId), [knowledgeId]),
    { enabled: Boolean(knowledgeId) },
  );
  const workspaces = useResource<WorkspaceSummary[]>(useCallback(() => fetchWorkspaces(), []));

  const { reload } = detail;

  // Approving, editing, archiving and restoring are offered only to someone
  // who may curate knowledge where this entry lives.
  const canCurate = useCan("knowledge.curate", detail.data?.knowledge.workspaceId ?? null);

  async function act(operation: () => Promise<unknown>) {
    setBusy(true);
    setActionError(undefined);

    try {
      await operation();
      setEditing(false);
      reload();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading) {
    return (
      <div className="entry">
        <Connecting what="Opening this piece of knowledge…" />
      </div>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <div className="entry pt-4">
        <Failure
          headline="This knowledge could not be opened"
          detail={detail.error?.message ?? "Nothing was returned for this id."}
          action={
            <>
              <button type="button" onClick={reload} className="button-ghost">Try again</button>
              <Link to="/brain" className="button-quiet">The Brain</Link>
            </>
          }
        />
      </div>
    );
  }

  const data = detail.data;
  const { knowledge, provenance, related, usage } = data;
  const extraction = provenance.extraction;
  const workspaceName = provenance.workspace?.name;

  return (
    <div className="entry fade-up">
      <Link to="/brain" className="entry-back">
        <ArrowLeft size={12} />
        The Brain
      </Link>

      <div className="entry-kind">
        <Chip tone={knowledgeStatusTone(knowledge.status)}>{knowledgeStatusLabel(knowledge.status)}</Chip>
        <Chip tone="idle">{kindLabel(knowledge.type)}</Chip>
        <span className="t-machine">{kindMeaning(knowledge.type)}</span>
      </div>

      {editing ? (
        <EditForm
          detail={data}
          workspaces={workspaces.data ?? []}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(changes) => void act(() => updateKnowledge(knowledge.id, changes))}
        />
      ) : (
        <>
          <h1 className="entry-title">{knowledge.title}</h1>
          {knowledge.content !== knowledge.title && <p className="entry-content">{knowledge.content}</p>}
        </>
      )}

      {data.flags.length > 0 && <div className="entry-flag">{flagSentence(data.flags)}</div>}

      {data.freshness.stale && (
        <p className="entry-stale">
          Last confirmed {data.freshness.ageDays} days ago — past the {data.freshness.horizonDays}-day window after
          which {kindLabel(knowledge.type).toLowerCase()}s are treated as possibly outdated. It is still recalled, marked
          as such, below current knowledge. Approving it again re-confirms it.
        </p>
      )}

      {actionError && (
        <div className="mt-5">
          <Failure headline="That change was not made" detail={actionError} consequence="This knowledge is exactly as it was." />
        </div>
      )}

      {!editing && canCurate && (
        <div className="entry-actions">
          {knowledge.status === "proposed" && (
            <button type="button" className="button-primary" disabled={busy} onClick={() => void act(() => approveKnowledge(knowledge.id))}>
              Approve — make it current
            </button>
          )}
          {knowledge.status === "active" && (
            <button type="button" className="button-ghost" disabled={busy} onClick={() => void act(() => approveKnowledge(knowledge.id))}>
              {knowledge.reviewedAt ? "Re-confirm" : "Mark reviewed"}
            </button>
          )}
          {knowledge.status !== "archived" && (
            <>
              <button type="button" className="button-quiet" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="button-quiet" disabled={busy} onClick={() => void act(() => archiveKnowledge(knowledge.id, "Archived from its detail page."))}>
                Archive
              </button>
            </>
          )}
          {knowledge.status === "archived" && (
            <button type="button" className="button-ghost" disabled={busy} onClick={() => void act(() => restoreKnowledge(knowledge.id))}>
              Restore as a proposal
            </button>
          )}
        </div>
      )}

      <div className="entry-grid">
        <div className="min-w-0">
          <section className="entry-section">
            <div className="entry-label">Where it came from</div>
            <ProvenanceTrail detail={data} />
          </section>

          <section className="entry-section">
            <div className="entry-label">Why it matters</div>
            {extraction?.rationale ? (
              <p className="t-body">{extraction.rationale}</p>
            ) : (
              <p className="t-meta">No rationale was recorded with this knowledge.</p>
            )}
            <Meter label="Importance" value={knowledge.importance} word={importanceWord(knowledge.importance)} />
            {knowledge.confidence !== undefined && (
              <Meter label="Confidence" value={knowledge.confidence} word={`${percent(knowledge.confidence)}%`} />
            )}
            {extraction?.governance && <p className="t-meta mt-3">Governance: {extraction.governance}</p>}
          </section>

          {data.conflicts.length > 0 && (
            <section className="entry-section">
              <div className="entry-label">Disagrees with</div>
              {data.conflicts.map(({ conflict, counterpart }) =>
                counterpart ? (
                  conflict.status === "open" ? (
                    <ConflictPair
                      key={conflict.id}
                      conflict={conflict}
                      left={knowledge}
                      right={counterpart}
                      busy={busy}
                      onDecide={(decision) => void act(() => resolveKnowledgeConflict(conflict.id, decision))}
                    />
                  ) : (
                    <div key={conflict.id} className="learned-line">
                      <div className="learned-when">{conflict.status}</div>
                      <div className="min-w-0">
                        <Link to={`/brain/${counterpart.id}`} className="learned-title">{counterpart.title}</Link>
                        <div className="learned-source">{conflict.resolution ?? conflict.reason}</div>
                      </div>
                    </div>
                  )
                ) : null,
              )}
            </section>
          )}

          <section className="entry-section">
            <div className="entry-label">Used by</div>
            {usage.missions.length === 0 ? (
              <p className="t-meta">No mission has been handed this knowledge yet.</p>
            ) : (
              usage.missions.map((entry) => (
                <div key={entry.mission.id} className="learned-line">
                  <div className="learned-when">{formatRelativeTime(entry.lastRecalledAt)}</div>
                  <div className="min-w-0">
                    <Link to={`/missions/${entry.mission.id}`} className="learned-title">{entry.mission.objective}</Link>
                    <div className="learned-source">
                      {entry.stages.map((stage) => (stage === "planning" ? "read by Tyrion while planning" : "handed to a step")).join(" and ")}
                      {" · "}ranked #{entry.bestRank}
                    </div>
                    {entry.reasons.length > 0 && (
                      <ul className="knowledge-why">
                        {entry.reasons.slice(0, 3).map((reason) => <li key={reason}>{reason}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>

          {related.similar.length > 0 && (
            <section className="entry-section">
              <div className="entry-label">Related knowledge</div>
              <div className="knowledge-list">
                {related.similar.map((entry) => (
                  <KnowledgeRow key={entry.knowledge.id} item={entry.knowledge} result={{ relevance: entry.relevance, reasons: entry.reasons, stale: false, flagged: false }} />
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="min-w-0">
          <section className="entry-section">
            <div className="entry-label">The record</div>
            <dl className="entry-facts">
              <dt>Source</dt>
              <dd>{sourceLabel(knowledge.sourceType)}</dd>
              <dt>Recorded by</dt>
              <dd>{actorLabel(knowledge.createdBy)}, {formatRelativeTime(knowledge.createdAt)}</dd>
              <dt>Reviewed</dt>
              <dd>{knowledge.reviewedAt ? `by ${actorLabel(knowledge.reviewedBy)}, ${formatRelativeTime(knowledge.reviewedAt)}` : "Not yet"}</dd>
              <dt>Applies</dt>
              <dd>{reachLabel(knowledge, workspaceName)}</dd>
              <dt>Freshness</dt>
              <dd>
                {data.freshness.horizonDays === null
                  ? "Does not go stale with age"
                  : `${data.freshness.ageDays} days since confirmed · treated as current for ${data.freshness.horizonDays}`}
              </dd>
              <dt>Confirmed</dt>
              <dd>
                {data.confirmations.length === 0
                  ? "Not yet by another mission"
                  : `Again by ${data.confirmations.length} later ${data.confirmations.length === 1 ? "mission" : "missions"}`}
              </dd>
              <dt>Recalled</dt>
              <dd>{usage.recallCount} {usage.recallCount === 1 ? "time" : "times"}</dd>
              <dt>Indexed</dt>
              <dd>{knowledge.embeddingModel ? `for semantic recall with ${knowledge.embeddingModel}` : "keywords only"}</dd>
              {extraction?.model && (
                <>
                  <dt>Extracted by</dt>
                  <dd>{extraction.model}</dd>
                </>
              )}
            </dl>
          </section>

          {data.confirmations.length > 0 && (
            <section className="entry-section">
              <div className="entry-label">Confirmed again by</div>
              {data.confirmations.map((entry, index) => (
                <div key={`${entry.mission?.id ?? "unnamed"}-${index}`} className="learned-line">
                  <div className="learned-when">
                    {entry.mergedAt ? formatRelativeTime(entry.mergedAt) : "—"}
                  </div>
                  <div className="min-w-0">
                    {entry.mission ? (
                      <Link to={`/missions/${entry.mission.id}`} className="learned-title">
                        {entry.mission.objective}
                      </Link>
                    ) : (
                      <span className="learned-title">A mission that is no longer available</span>
                    )}
                    {entry.wording && <div className="learned-source">in its words: “{entry.wording}”</div>}
                  </div>
                </div>
              ))}
            </section>
          )}

          {(related.supersedes || related.supersededBy || related.mergedInto) && (
            <section className="entry-section">
              <div className="entry-label">History</div>
              {related.mergedInto && (
                <p className="t-body">
                  Merged into <Link to={`/brain/${related.mergedInto.id}`} className="text-[#84b4fb]">{related.mergedInto.title}</Link>, which says the same thing
                </p>
              )}
              {related.supersededBy && (
                <p className="t-body">
                  Superseded by <Link to={`/brain/${related.supersededBy.id}`} className="text-[#84b4fb]">{related.supersededBy.title}</Link>
                </p>
              )}
              {related.supersedes && (
                <p className="t-body">
                  Replaces <Link to={`/brain/${related.supersedes.id}`} className="text-[#84b4fb]">{related.supersedes.title}</Link>
                </p>
              )}
            </section>
          )}

          {related.sameMission.length > 0 && (
            <section className="entry-section">
              <div className="entry-label">Learned in the same mission</div>
              {related.sameMission.map((item) => (
                <div key={item.id} className="learned-line">
                  <div className="learned-when">{kindLabel(item.type)}</div>
                  <Link to={`/brain/${item.id}`} className="learned-title">{item.title}</Link>
                </div>
              ))}
            </section>
          )}

          {related.sameArtifact.length > 0 && (
            <section className="entry-section">
              <div className="entry-label">From the same artifact</div>
              {related.sameArtifact.map((item) => (
                <div key={item.id} className="learned-line">
                  <div className="learned-when">{kindLabel(item.type)}</div>
                  <Link to={`/brain/${item.id}`} className="learned-title">{item.title}</Link>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Meter({ label, value, word }: { label: string; value: number; word: string }) {
  return (
    <div className="entry-meter">
      <span className="t-meta">{label}</span>
      <span className="entry-meter-track">
        <span className="entry-meter-fill" style={{ display: "block", width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="t-machine">{word}</span>
    </div>
  );
}

function EditForm({
  detail,
  workspaces,
  busy,
  onCancel,
  onSave,
}: {
  detail: KnowledgeDetail;
  workspaces: WorkspaceSummary[];
  busy: boolean;
  onCancel: () => void;
  onSave: (changes: {
    title: string;
    content: string;
    type: KnowledgeType;
    importance: number;
    workspaceId: string | null;
  }) => void;
}) {
  const { knowledge } = detail;
  const [title, setTitle] = useState(knowledge.title);
  const [content, setContent] = useState(knowledge.content);
  const [type, setType] = useState<KnowledgeType>(knowledge.type === "experience" ? "fact" : knowledge.type);
  const [importance, setImportance] = useState(knowledge.importance);
  const [workspaceId, setWorkspaceId] = useState(knowledge.workspaceId ?? "");

  return (
    <div className="space-y-3">
      <input className="entry-input" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} aria-label="Title" />
      <textarea className="entry-input" value={content} rows={6} maxLength={4000} onChange={(event) => setContent(event.target.value)} aria-label="Content" />

      <div className="flex flex-wrap gap-2">
        <select className="brain-select" value={type} onChange={(event) => setType(event.target.value as KnowledgeType)} aria-label="Kind">
          {WRITABLE_KINDS.map((kind) => <option key={kind.type} value={kind.type}>{kind.label}</option>)}
        </select>

        <select className="brain-select" value={importance} onChange={(event) => setImportance(Number(event.target.value))} aria-label="Importance">
          {[0.3, 0.5, 0.75, 0.95].concat([importance]).filter((value, index, all) => all.indexOf(value) === index).sort().map((value) => (
            <option key={value} value={value}>{importanceWord(value)} ({percent(value)})</option>
          ))}
        </select>

        <select className="brain-select" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} aria-label="Where it applies">
          <option value="">The whole company</option>
          {workspaces.map((entry) => <option key={entry.workspace.id} value={entry.workspace.id}>Only {entry.workspace.name}</option>)}
        </select>
      </div>

      <p className="t-meta">
        Saving re-indexes it for recall and checks it against everything else the company knows for contradictions.
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          className="button-primary"
          disabled={busy || title.trim().length < 3 || content.trim().length < 3}
          onClick={() => onSave({ title: title.trim(), content: content.trim(), type, importance, workspaceId: workspaceId || null })}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="button-quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
