import { useState } from "react";
import { Link } from "react-router-dom";

import {
  approveKnowledge,
  archiveKnowledge,
  mergeKnowledge,
  supersedeKnowledge,
  updateKnowledge,
  type MissionDebriefItem,
  type MissionDebriefRelation,
} from "../../lib/api";

import { useCan } from "../../lib/access";
import { kindLabel } from "../../lib/knowledge";

import { Chip, Failure } from "../primitives";

/**
 * The mission debrief.
 *
 * A mission ends with things it believes the company should know. This is
 * where a person decides, next to the evidence: keep it, fold it into what the
 * company already knew, let it replace something older, or let it go. Every
 * relation shown - "says the same as", "contradicts" - was measured by the
 * backend; the page only puts the decision in reach. Nothing here decides on
 * its own, and every decision is a recorded, reversible change in the Brain.
 */

const RELATION_LABEL: Record<MissionDebriefRelation["relation"], string> = {
  restates: "Says the same as",
  contradicts: "Contradicts",
  related: "Related to",
};

export function MissionDebrief({
  review,
  live,
  onChanged,
}: {
  review: MissionDebriefItem[];
  /** The mission is still running, so more may be proposed. */
  live: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<{ id: string; title: string; content: string }>();

  // Deciding what the company keeps is curation: offered to owners and admins,
  // and refused by the API for anyone else.
  const canCurate = useCan("knowledge.curate");

  const pending = review.filter((item) => item.outcome === "pending");
  const decided = review.filter((item) => item.outcome !== "pending");

  async function decide(itemId: string, operation: () => Promise<unknown>) {
    setBusy(itemId);
    setError(undefined);

    try {
      await operation();
      setEditing(undefined);
      // Stay busy until the debrief has been re-read, so a decision cannot be
      // made twice against a row that has already changed.
      await onChanged();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  function keep(item: MissionDebriefItem) {
    const draft = editing?.id === item.knowledge.id ? editing : undefined;
    const changed =
      draft &&
      (draft.title.trim() !== item.knowledge.title || draft.content.trim() !== item.knowledge.content);

    return decide(item.knowledge.id, async () => {
      if (changed) {
        await updateKnowledge(item.knowledge.id, {
          title: draft.title.trim(),
          content: draft.content.trim(),
        });
      }

      await approveKnowledge(item.knowledge.id);
    });
  }

  const counts = {
    kept: decided.filter((item) => item.outcome === "kept").length,
    merged: decided.filter((item) => item.outcome === "merged").length,
    replaced: decided.filter((item) => item.outcome === "replaced").length,
    discarded: decided.filter((item) => item.outcome === "discarded").length,
  };

  return (
    <section className="debrief" aria-labelledby="debrief-title">
      <p id="debrief-title" className="room-headline">
        What this mission taught the company
      </p>

      <p className="room-lead">
        {live
          ? "Proposed as its steps finish, each from what a step actually produced. You can decide now or once it is done."
          : "Proposed from what its steps actually produced. Until someone decides, each is recalled into later missions only as an unverified lead."}
      </p>

      <div className="debrief-summary">
        <span className={pending.length > 0 ? "debrief-summary-open" : undefined}>
          {pending.length === 0 ? "Nothing left to decide" : `${pending.length} to decide`}
        </span>
        {counts.kept > 0 && <span>{counts.kept} kept</span>}
        {counts.merged > 0 && <span>{counts.merged} merged into existing knowledge</span>}
        {counts.replaced > 0 && <span>{counts.replaced} replaced</span>}
        {counts.discarded > 0 && <span>{counts.discarded} discarded</span>}
      </div>

      {error && (
        <div className="mb-4">
          <Failure
            headline="That decision was not recorded"
            detail={error}
            consequence="The company's knowledge is exactly as it was."
          />
        </div>
      )}

      {pending.map((item) => {
        const { knowledge } = item;
        const draft = editing?.id === knowledge.id ? editing : undefined;
        const working = busy === knowledge.id;
        const locked = Boolean(busy);

        return (
          <article key={knowledge.id} className="debrief-item" aria-busy={working}>
            <div className="debrief-kind">
              <Chip tone="warning">{kindLabel(knowledge.type)}</Chip>
            </div>

            <div className="min-w-0">
              {draft ? (
                <div className="space-y-2">
                  <input
                    className="entry-input"
                    value={draft.title}
                    maxLength={160}
                    aria-label="What the company should know"
                    onChange={(event) => setEditing({ ...draft, title: event.target.value })}
                  />
                  <textarea
                    className="entry-input"
                    rows={3}
                    value={draft.content}
                    maxLength={4000}
                    aria-label="Detail"
                    onChange={(event) => setEditing({ ...draft, content: event.target.value })}
                  />
                </div>
              ) : (
                <>
                  <Link to={`/brain/${knowledge.id}`} className="debrief-title">
                    {knowledge.title}
                  </Link>
                  {knowledge.content !== knowledge.title && (
                    <p className="debrief-content">{knowledge.content}</p>
                  )}
                </>
              )}

              <Evidence item={item} />

              {item.related.length > 0 && (
                <ul className="debrief-relations">
                  {item.related.map((relation) => (
                    <li
                      key={relation.knowledge.id}
                      className={`debrief-relation debrief-relation-${relation.relation}`}
                    >
                      <span className="debrief-relation-label">{RELATION_LABEL[relation.relation]}</span>
                      <Link to={`/brain/${relation.knowledge.id}`} className="debrief-relation-title">
                        {relation.knowledge.title}
                      </Link>
                      <span className="t-machine">
                        {kindLabel(relation.knowledge.type)} ·{" "}
                        {relation.knowledge.status === "active" ? "current" : "proposed"}
                      </span>

                      {!canCurate ? null : relation.relation === "restates" ? (
                        <button
                          type="button"
                          className="button-quiet"
                          disabled={locked || !relation.canMerge}
                          title={
                            relation.canMerge
                              ? undefined
                              : "That entry only applies in one workspace, and this applies more widely."
                          }
                          onClick={() => void decide(knowledge.id, () => mergeKnowledge(knowledge.id, relation.knowledge.id))}
                        >
                          Merge into it
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button-quiet"
                          disabled={locked}
                          onClick={() => void decide(knowledge.id, () => supersedeKnowledge(knowledge.id, relation.knowledge.id))}
                        >
                          This replaces it
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {canCurate && (
              <div className="debrief-actions">
                <button
                  type="button"
                  className="button-ghost"
                  disabled={locked || (draft ? draft.title.trim().length < 3 || draft.content.trim().length < 3 : false)}
                  onClick={() => void keep(item)}
                >
                  {working ? "Recording…" : draft ? "Save and keep" : "Keep as company knowledge"}
                </button>

                {draft ? (
                  <button type="button" className="button-quiet" disabled={locked} onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="button-quiet"
                    disabled={locked}
                    onClick={() => setEditing({ id: knowledge.id, title: knowledge.title, content: knowledge.content })}
                  >
                    Edit
                  </button>
                )}

                <button
                  type="button"
                  className="button-quiet"
                  disabled={locked}
                  onClick={() =>
                    void decide(knowledge.id, () =>
                      archiveKnowledge(knowledge.id, "Discarded in the mission debrief."),
                    )
                  }
                >
                  Discard
                </button>
              </div>
              )}
            </div>
          </article>
        );
      })}

      {decided.length > 0 && (
        <div className={pending.length > 0 ? "mt-6" : undefined}>
          {decided.map((item) => (
            <div key={item.knowledge.id} className="learned-line">
              <div className="learned-when">{OUTCOME_WORD[item.outcome]}</div>
              <div className="min-w-0">
                <Link to={`/brain/${item.knowledge.id}`} className="learned-title">
                  {item.knowledge.title}
                </Link>
                <div className="learned-source">
                  {kindLabel(item.knowledge.type)}
                  <Outcome item={item} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const OUTCOME_WORD: Record<MissionDebriefItem["outcome"], string> = {
  pending: "to decide",
  kept: "kept",
  merged: "merged",
  replaced: "replaced",
  discarded: "discarded",
};

function Evidence({ item }: { item: MissionDebriefItem }) {
  const { task, agent, artifact, rationale } = item.evidence;
  const parts = [
    task && `from the step “${task.title}”`,
    agent && `by ${agent.name}`,
    artifact && `in “${artifact.name}”`,
  ].filter(Boolean);

  return (
    <>
      <p className="debrief-evidence">
        {parts.length > 0 ? parts.join(" · ") : "No step or artifact is recorded for this."}
      </p>
      {rationale && <p className="debrief-why">{rationale}</p>}
    </>
  );
}

function Outcome({ item }: { item: MissionDebriefItem }) {
  const target =
    item.outcome === "merged" ? item.mergedInto :
    item.outcome === "replaced" ? item.replacedBy :
    item.outcome === "kept" ? item.replaces :
    undefined;

  if (!target) return null;

  const words =
    item.outcome === "merged" ? " · merged into " :
    item.outcome === "replaced" ? " · replaced by " :
    " · replaces ";

  return (
    <>
      {words}
      <Link to={`/brain/${target.id}`} className="hover:text-blue-ink">
        “{target.title}”
      </Link>
    </>
  );
}
