import { ChevronDown } from "lucide-react";

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  formatRelativeTime,
  type GovernanceDecisionRecord,
} from "../../lib/api";

import {
  decisionTone,
  outcomeLabel,
  riskTone,
} from "../../lib/governance";

import { toneClass } from "../../lib/tone";
import { Chip, Quiet } from "../primitives";

/**
 * What actually happened.
 *
 * Every line is one decision the engine made, written as a sentence: what was
 * attempted, who attempted it, what was decided, and which rule decided it.
 * The technical detail - every policy that took part and why each matched -
 * is one click away rather than dumped inline, because an audit trail that
 * opens as JSON is one nobody reads.
 *
 * Paged rather than scrolled. A company that has been running for a while has
 * thousands of these, and rendering all of them to show the last ten is how a
 * control surface becomes slow exactly when it is being used in anger.
 */

const PAGE = 12;

type Filter = "all" | "denied" | "approval_required" | "allowed";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "denied", label: "Blocked" },
  { id: "approval_required", label: "Sent to a person" },
  { id: "allowed", label: "Permitted" },
];

export function AuditTrail({
  decisions,
}: {
  decisions: GovernanceDecisionRecord[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);

  const visible = useMemo(
    () =>
      filter === "all"
        ? decisions
        : decisions.filter((decision) => decision.outcome === filter),
    [decisions, filter],
  );

  const available = useMemo(() => {
    const present = new Set(decisions.map((decision) => decision.outcome));
    return FILTERS.filter(
      (entry) => entry.id === "all" || present.has(entry.id),
    );
  }, [decisions]);

  if (decisions.length === 0) {
    return (
      <Quiet
        line="Governance has not had to decide anything yet."
        detail="Every step and every tool call is checked. Once a rule applies to one, the decision and the reasoning behind it are recorded here."
      />
    );
  }

  return (
    <div>
      {available.length > 2 && (
        <div className="filter-group mb-4">
          {available.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setFilter(entry.id);
                setShown(PAGE);
              }}
              className={`filter-tab${filter === entry.id ? " filter-tab-active" : ""}`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="t-meta py-3">Nothing under that heading.</p>
      ) : (
        <div className="audit">
          {visible.slice(0, shown).map((decision) => (
            <Decision key={decision.eventId} decision={decision} />
          ))}
        </div>
      )}

      {visible.length > shown && (
        <button
          type="button"
          onClick={() => setShown((value) => value + PAGE)}
          className="button-quiet mt-4"
        >
          {visible.length - shown} earlier
        </button>
      )}
    </div>
  );
}

function Decision({ decision }: { decision: GovernanceDecisionRecord }) {
  const [open, setOpen] = useState(false);
  const tone = decisionTone(decision.outcome);

  return (
    <article className={`audit-entry ${toneClass[tone]}`}>
      <button
        type="button"
        className="audit-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="audit-node" aria-hidden="true" />

        <span className="min-w-0 flex-1">
          {/* The sentence. Everything a reader needs without opening it. */}
          <span className="audit-line">
            <span className="audit-actor">
              {decision.agentName ?? "The company"}
            </span>{" "}
            tried “{decision.action}” — it was{" "}
            <span className="audit-outcome">
              {outcomeLabel(decision.outcome)}
            </span>
            {decision.policyName ? ` by ${decision.policyName}` : ""}.
          </span>

          <span className="audit-facts">
            <Chip tone={riskTone(decision.risk)}>{decision.risk} risk</Chip>

            {decision.workId && (
              <Link
                to={`/missions/${decision.workId}`}
                className="audit-link"
                onClick={(event) => event.stopPropagation()}
              >
                Open the mission
              </Link>
            )}

            <span className="t-machine">{formatRelativeTime(decision.at)}</span>
          </span>
        </span>

        <ChevronDown
          size={13}
          className={`audit-chevron${open ? " audit-chevron-open" : ""}`}
        />
      </button>

      {open && (
        <div className="audit-body">
          <dl className="audit-detail">
            <Row label="Action">{decision.action}</Row>
            <Row label="Actor">{decision.agentName ?? "Not attributed"}</Row>
            <Row label="Decision">{outcomeLabel(decision.outcome)}</Row>
            <Row label="Risk">{decision.risk}</Row>

            {decision.policyName && (
              <Row label="Deciding rule">{decision.policyName}</Row>
            )}

            <Row label="Reason">{decision.summary}</Row>
          </dl>

          {decision.reasons.length > 0 && (
            <div className="audit-reasons">
              <div className="detail-label mb-2">
                {decision.reasons.length === 1
                  ? "The rule that applied"
                  : `All ${decision.reasons.length} rules that applied`}
              </div>

              {decision.reasons.map((reason, index) => (
                <div
                  key={`${reason.policyId ?? reason.policyName}-${index}`}
                  className="audit-reason"
                >
                  <span className="audit-reason-name">{reason.policyName}</span>
                  <span className="audit-reason-effect">{reason.effect}</span>
                  <span className="audit-reason-why">{reason.explanation}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="audit-detail-row">
      <dt className="audit-detail-label">{label}</dt>
      <dd className="audit-detail-value">{children}</dd>
    </div>
  );
}
