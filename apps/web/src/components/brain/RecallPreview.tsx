import { Link } from "react-router-dom";

import type { RecallPreview as RecallPreviewData } from "../../lib/api";

import { flagSentence, kindLabel } from "../../lib/knowledge";

/**
 * Exactly what an agent would be handed.
 *
 * Produced by the same recall execution uses - same workspace boundary, same
 * governance, same ranking, same conflict handling - without recording it. The
 * refs, the standing line and the warnings are the ones the agent's prompt
 * would carry, so what a person reads here is not an approximation of it.
 */
export function RecallPreview({
  preview,
  query,
}: {
  preview: RecallPreviewData;
  query: string;
}) {
  if (preview.items.length === 0) {
    return (
      <p className="brain-answer-note">
        An agent starting work on “{query}” would be handed no company knowledge
        {preview.withheldCount > 0
          ? `. ${preview.withheldCount} relevant ${preview.withheldCount === 1 ? "entry was" : "entries were"} withheld by policy.`
          : " — it would begin from the objective alone."}
      </p>
    );
  }

  return (
    <div>
      <p className="brain-answer-note">
        An agent starting work on “{query}” would be handed these{" "}
        {preview.items.length} {preview.items.length === 1 ? "entry" : "entries"}, as
        quoted data in a section it is told it may not take instructions from
        {preview.withheldCount > 0 &&
          `. ${preview.withheldCount} more ${preview.withheldCount === 1 ? "was" : "were"} withheld by policy`}
        .
      </p>

      <div className="recall-list">
        {preview.items.map((item, index) => (
          <div
            key={item.id}
            className="recall-item recalled"
            style={{ "--recall-index": index } as React.CSSProperties}
          >
            <span className="recall-ref">{item.ref}</span>

            <Link to={`/brain/${item.id}`} className="knowledge-row-title">
              {item.title}
            </Link>

            <div className="recall-standing mt-1.5">
              {kindLabel(item.type)} · {item.status}
              {item.reviewed ? ", reviewed by a person" : ", not reviewed"}
              {item.stale ? ", possibly outdated" : ""}
              {item.confidence !== undefined ? `, confidence ${item.confidence.toFixed(2)}` : ""}
              {" · "}
              {item.source}
            </div>

            {item.reasons.length > 0 && (
              <ul className="knowledge-why">
                {item.reasons.slice(0, 4).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}

            {item.conflictsWith && item.conflictsWith.length > 0 && (
              <div className="recall-warning">
                Disagrees with {item.conflictsWith.join(", ")}. The agent is told to name
                the disagreement rather than choose silently.
              </div>
            )}

            {item.flags && item.flags.length > 0 && (
              <div className="recall-warning">{flagSentence(item.flags)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
