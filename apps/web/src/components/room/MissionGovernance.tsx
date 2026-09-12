import { Link } from "react-router-dom";

import type { ActivityEvent } from "../../lib/api";

import { toneClass } from "../../lib/tone";

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

export interface MissionGovernanceSummary {
  allowed: number;
  approvalRequired: number;
  denied: number;
  /** The rules that took part, newest first, de-duplicated. */
  policyNames: string[];
  /** What was blocked, if anything was. */
  blocked: Array<{ action: string; policyName?: string; summary: string }>;
}

export function summarizeGovernance(
  events: ActivityEvent[],
): MissionGovernanceSummary {
  const summary: MissionGovernanceSummary = {
    allowed: 0,
    approvalRequired: 0,
    denied: 0,
    policyNames: [],
    blocked: [],
  };

  const names = new Set<string>();

  for (const event of events) {
    if (!event.type.startsWith("governance.")) continue;

    const payload = event.payload ?? {};
    const policyName =
      typeof payload.policyName === "string" ? payload.policyName : undefined;

    if (policyName) names.add(policyName);

    if (event.type === "governance.denied") {
      summary.denied += 1;
      summary.blocked.push({
        action:
          typeof payload.action === "string" ? payload.action : "An action",
        policyName,
        summary:
          typeof payload.summary === "string"
            ? payload.summary
            : "A policy refused this.",
      });
    } else if (event.type === "governance.approval_required") {
      summary.approvalRequired += 1;
    } else {
      summary.allowed += 1;
    }
  }

  summary.policyNames = [...names];

  return summary;
}

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
