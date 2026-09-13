import { Link } from "react-router-dom";

import {
  formatRelativeTime,
  type KnowledgeConflictItem,
  type KnowledgeItem,
} from "../../lib/api";

import { kindLabel, knowledgeStatusLabel, percent, sourceLabel } from "../../lib/knowledge";

export type ConflictDecision =
  | { resolution: "keep"; keepId: string }
  | { resolution: "both_hold" }
  | { resolution: "dismiss" };

/**
 * Two things the company believes that cannot both be true.
 *
 * The system found the disagreement and will not settle it. Both sides are
 * shown with what a person needs to choose - when each was recorded, how, how
 * important and how sure - and the choices are the only ones the backend
 * accepts: keep one (the other is archived as superseded, not deleted), keep
 * both because they hold in different circumstances, or say it was never a
 * real conflict.
 */
export function ConflictPair({
  conflict,
  left,
  right,
  busy,
  onDecide,
}: {
  conflict: KnowledgeConflictItem;
  left: KnowledgeItem;
  right: KnowledgeItem;
  busy: boolean;
  onDecide: (decision: ConflictDecision) => void;
}) {
  return (
    <div className="conflict-pair">
      <p className="conflict-reason">{conflict.reason}</p>

      <div className="conflict-sides">
        <Side item={left} />
        <span className="conflict-versus" aria-hidden="true">vs</span>
        <Side item={right} />
      </div>

      <div className="conflict-actions">
        <button
          type="button"
          className="button-ghost"
          disabled={busy}
          onClick={() => onDecide({ resolution: "keep", keepId: left.id })}
        >
          Keep the first
        </button>
        <button
          type="button"
          className="button-ghost"
          disabled={busy}
          onClick={() => onDecide({ resolution: "keep", keepId: right.id })}
        >
          Keep the second
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={busy}
          onClick={() => onDecide({ resolution: "both_hold" })}
        >
          Both hold
        </button>
        <button
          type="button"
          className="button-quiet"
          disabled={busy}
          onClick={() => onDecide({ resolution: "dismiss" })}
        >
          Not a conflict
        </button>
      </div>
    </div>
  );
}

function Side({ item }: { item: KnowledgeItem }) {
  return (
    <div className="conflict-side">
      <Link to={`/brain/${item.id}`} className="conflict-side-title">
        {item.title}
      </Link>

      <div className="conflict-side-meta">
        {kindLabel(item.type)} · {knowledgeStatusLabel(item.status)}
        <br />
        {sourceLabel(item.sourceType)} · {formatRelativeTime(item.createdAt)}
        <br />
        importance {percent(item.importance)}
        {item.confidence !== undefined && ` · confidence ${percent(item.confidence)}`}
      </div>
    </div>
  );
}
