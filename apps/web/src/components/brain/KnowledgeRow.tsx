import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import {
  formatRelativeTime,
  type KnowledgeItem,
  type KnowledgeSearchResult,
} from "../../lib/api";

import {
  excerpt,
  kindLabel,
  knowledgeStatusLabel,
  knowledgeStatusTone,
  percent,
  sourceLabel,
} from "../../lib/knowledge";

import { Chip } from "../primitives";

/**
 * One piece of knowledge in a list.
 *
 * When the list answers a question, the margin carries how relevant each entry
 * was and the row says why it was retrieved - the reasons the ranker actually
 * produced, never a paraphrase of them. When the list is just the newest
 * knowledge, the margin carries importance instead, because that is the only
 * weight the row has.
 */
export function KnowledgeRow({
  item,
  result,
  index = 0,
  animate = false,
  workspaceName,
  actions,
}: {
  item: KnowledgeItem;
  result?: Pick<KnowledgeSearchResult, "relevance" | "reasons" | "stale" | "flagged" | "disputed">;
  index?: number;
  animate?: boolean;
  workspaceName?: string;
  actions?: ReactNode;
}) {
  const relevance = result?.relevance;
  const weight = relevance ?? item.importance;

  return (
    <article
      className={`knowledge-row${animate ? " recalled" : ""}`}
      style={{ "--recall-index": index } as React.CSSProperties}
    >
      <div className="knowledge-row-weight" aria-hidden="true">
        <span className="knowledge-relevance">{percent(weight)}</span>
        <span className="knowledge-relevance-label">
          {relevance === undefined ? "weight" : "match"}
        </span>
        <span className="knowledge-relevance-track">
          <span
            className="knowledge-relevance-fill"
            style={{ display: "block", height: `${Math.round(weight * 100)}%` }}
          />
        </span>
      </div>

      <div className="min-w-0">
        <Link to={`/brain/${item.id}`} className="knowledge-row-title">
          {item.title}
        </Link>

        {item.content !== item.title && (
          <p className="knowledge-row-content">{excerpt(item.content, 320)}</p>
        )}

        {result && result.reasons.length > 0 && (
          <ul className="knowledge-why" aria-label="Why this was retrieved">
            {result.reasons.slice(0, 4).map((reason) => (
              <li
                key={reason}
                className={
                  /outdated|Unreviewed/.test(reason) ? "knowledge-why-warn" : undefined
                }
              >
                {reason}
              </li>
            ))}
          </ul>
        )}

        <div className="knowledge-row-foot">
          <Chip tone={knowledgeStatusTone(item.status)}>
            {knowledgeStatusLabel(item.status)}
          </Chip>
          <Chip tone="idle">{kindLabel(item.type)}</Chip>

          <span className="t-machine">{sourceLabel(item.sourceType)}</span>

          <span className="t-machine">
            {item.workspaceId ? (workspaceName ? `in ${workspaceName}` : "workspace only") : "company-wide"}
          </span>

          <span className="t-machine" title={new Date(item.createdAt).toLocaleString()}>
            {formatRelativeTime(item.createdAt)}
          </span>

          {result?.stale && (
            <span className="knowledge-marker knowledge-marker-stale">may be outdated</span>
          )}

          {result?.flagged && (
            <span className="knowledge-marker knowledge-marker-flag">instruction-shaped text</span>
          )}

          {/* A contested entry looks exactly like a settled one otherwise,
              and somebody reading a search result rarely goes on to check
              the Brain's list of disagreements before acting on it. */}
          {result?.disputed && (
            <span className="knowledge-marker knowledge-marker-disputed">disputed</span>
          )}

          {actions && <span className="knowledge-row-actions">{actions}</span>}
        </div>
      </div>
    </article>
  );
}
