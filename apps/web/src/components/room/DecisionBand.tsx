import { formatRelativeTime, type ApprovalItem } from "../../lib/api";

/**
 * The room stopping.
 *
 * When something needs a person the operation does not merely grow a panel -
 * it changes state, and this band is that change made visible. It answers the
 * four questions a decision actually has, in the order a person asks them:
 * what is being asked, why it stopped here, what happens if I say yes, and
 * what happens if I say no.
 *
 * "Approve?" with no consequence attached is not a decision. It is a dialog
 * box, and people learn to click through those.
 */
export function DecisionBand({
  approvals,
  requestedBy,
  holding,
  busy,
  onDecide,
}: {
  approvals: ApprovalItem[];
  /** Names the agent that asked, rather than printing its id. */
  requestedBy: (agentId: string | undefined) => string;
  /** Names the step this decision is holding up. */
  holding: (resource: string) => string;
  busy: boolean;
  onDecide: (approvalId: string, decision: "approve" | "reject") => void;
}) {
  if (approvals.length === 0) return null;

  return (
    <section className="decision-band" aria-live="polite">
      <div className="decision-band-rail" aria-hidden="true" />

      <div className="decision-band-inner">
        <div className="decision-band-eyebrow">
          <span className="decision-band-pulse" aria-hidden="true" />
          {approvals.length === 1
            ? "The company stopped here"
            : `The company stopped at ${approvals.length} steps`}
        </div>

        {approvals.map((approval) => {
          const step = holding(approval.resource);

          return (
            <div key={approval.id} className="decision">
              <h3 className="decision-action">{approval.action}</h3>

              <p className="decision-why">{approval.reason}</p>

              <div className="decision-outcomes">
                <div className="decision-outcome decision-outcome-yes">
                  <span className="decision-outcome-label">If you approve</span>
                  The mission goes straight back on the durable queue and a
                  worker resumes it from this step.
                </div>

                <div className="decision-outcome decision-outcome-no">
                  <span className="decision-outcome-label">If you reject</span>
                  This step is not taken. The mission stops here and nothing
                  downstream of it runs.
                </div>
              </div>

              <div className="decision-provenance">
                {/* The action and the step it blocks are usually the same
                    sentence, and saying it twice is noise, not context. */}
                {step !== approval.action && <>holding up {step} · </>}
                asked by {requestedBy(approval.agentId)} ·{" "}
                {formatRelativeTime(approval.createdAt)}
              </div>

              <div className="decision-buttons">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(approval.id, "approve")}
                  className="button-primary button-approve-strong"
                >
                  Approve and continue
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDecide(approval.id, "reject")}
                  className="button-ghost button-reject"
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
