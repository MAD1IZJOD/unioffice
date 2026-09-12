import { Link } from "react-router-dom";

import { toneClass } from "../../lib/tone";

import type { MissionGovernanceSummary } from "../../lib/governance";

/**
 * Governance, as it applied to one mission.
 *
 * Counted from this mission's own event log rather than from a governance
 * read, so the numbers describe what happened to this operation and cannot
 * disagree with the record beside them.
 *
 * Rendered only when governance actually did something. A mission nothing
 * constrained does not get a panel saying zero, because a row of zeros reads
 * as a system that is not working rather than one that had nothing to say.
 */
export function MissionGovernance({
  summary,
}: {
  summary: MissionGovernanceSummary;
}) {
  const touched =
    summary.allowed + summary.approvalRequired + summary.denied > 0;

  if (!touched) return null;

  return (
    <section className="mission-governance">
      <header className="mission-governance-head">
        <span className="t-eyebrow">Governance</span>

        <Link to="/governance" className="button-quiet">
          The rules
        </Link>
      </header>

      <div className="mission-governance-counts">
        {summary.denied > 0 && (
          <Count
            value={summary.denied}
            label={summary.denied === 1 ? "action blocked" : "actions blocked"}
            tone="error"
          />
        )}

        {summary.approvalRequired > 0 && (
          <Count
            value={summary.approvalRequired}
            label={
              summary.approvalRequired === 1
                ? "step sent to you"
                : "steps sent to you"
            }
            tone="warning"
          />
        )}

        {summary.allowed > 0 && (
          <Count
            value={summary.allowed}
            label={
              summary.allowed === 1
                ? "action explicitly permitted"
                : "actions explicitly permitted"
            }
            tone="live"
          />
        )}
      </div>

      {summary.blocked.length > 0 && (
        <div className="mission-governance-blocked">
          {summary.blocked.map((entry, index) => (
            <p key={`${entry.action}-${index}`}>{entry.summary}</p>
          ))}
        </div>
      )}

      {summary.policyNames.length > 0 && (
        <p className="mission-governance-rules">
          Under {summary.policyNames.join(", ")}.
        </p>
      )}
    </section>
  );
}

function Count({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "error" | "warning" | "live";
}) {
  return (
    <span className={`mission-governance-count ${toneClass[tone]}`}>
      <span className="mission-governance-value">{value}</span>
      <span className="mission-governance-label">{label}</span>
    </span>
  );
}
