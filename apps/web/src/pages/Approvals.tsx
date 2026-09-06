import { ShieldCheck } from "lucide-react";

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchPendingApprovals,
  formatRelativeTime,
  resolveApproval,
  type ApprovalItem,
} from "../lib/api";

import { useResource } from "../lib/useResource";

import {
  EmptyState,
  ErrorState,
  Panel,
  SectionHeading,
  Skeleton,
  StatusPill,
} from "../components/primitives";

// No auth yet, so decisions are attributed to the seeded development
// requester rather than inventing an identity the backend cannot verify.
const RESOLVER_ID = "1db667b1-3bd4-4d64-a7e4-dd5a5f2f4b09";

export default function Approvals() {
  const approvals = useResource<ApprovalItem[]>(
    useCallback(() => fetchPendingApprovals(), []),
    { pollMs: 15_000 },
  );

  const [resolving, setResolving] = useState<string>();
  const [error, setError] = useState<string>();
  const [resolved, setResolved] = useState<
    Record<string, { decision: "approve" | "reject"; at: string }>
  >({});

  async function decide(
    approval: ApprovalItem,
    decision: "approve" | "reject",
  ) {
    setResolving(approval.id);
    setError(undefined);

    try {
      await resolveApproval(approval.id, decision, RESOLVER_ID);
      setResolved((current) => ({
        ...current,
        [approval.id]: { decision, at: new Date().toISOString() },
      }));
      approvals.reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setResolving(undefined);
    }
  }

  const pending = approvals.data ?? [];
  const recentDecisions = Object.entries(resolved);

  return (
    <div className="mx-auto max-w-[980px] fade-up">
      <SectionHeading
        title="Approvals"
        description="Tasks the planner marked as consequential stop here. Approving one resumes its work immediately; rejecting one leaves it recorded and unexecuted."
      />

      {error && <div className="callout callout-error mb-4">{error}</div>}

      <Panel
        eyebrow="Queue"
        title={
          approvals.loading
            ? "Loading"
            : `${pending.length} awaiting a decision`
        }
        padded={false}
      >
        {approvals.loading ? (
          <div className="p-[18px]">
            <Skeleton rows={4} />
          </div>
        ) : approvals.error ? (
          <ErrorState
            message={approvals.error.message}
            offline={approvals.error.isOffline}
            onRetry={approvals.reload}
          />
        ) : pending.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="Nothing needs your approval"
            description="Work runs unattended until the planner flags a task as requiring a human decision."
          />
        ) : (
          <div className="stack-list">
            {pending.map((approval) => (
              <div key={approval.id} className="px-[18px] py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-slate-100">
                      {approval.action}
                    </div>

                    <div className="mt-1.5 mono text-[9px] text-slate-600">
                      {approval.resource}
                    </div>
                  </div>

                  <StatusPill tone="warning" pulse>
                    {approval.status}
                  </StatusPill>
                </div>

                <div className="callout callout-warning mt-3.5">
                  <div className="detail-label mb-1.5">Why this needs you</div>
                  {approval.reason}
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-4 mono text-[9.5px] text-slate-600">
                  <span>requested {formatRelativeTime(approval.createdAt)}</span>

                  <Link
                    to={`/work/${approval.workId}`}
                    className="text-cyan-300/80 hover:text-cyan-200"
                  >
                    open the work
                  </Link>
                </div>

                <p className="mt-3 text-[10.5px] leading-[1.6] text-slate-500">
                  Approving resumes execution of this task and everything that
                  depends on it. Rejecting leaves the decision recorded and the
                  task unexecuted.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={resolving === approval.id}
                    onClick={() => decide(approval, "approve")}
                    className="button-ghost button-approve"
                  >
                    {resolving === approval.id
                      ? "Working…"
                      : "Approve and continue"}
                  </button>

                  <button
                    type="button"
                    disabled={resolving === approval.id}
                    onClick={() => decide(approval, "reject")}
                    className="button-ghost button-reject"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {recentDecisions.length > 0 && (
        <Panel className="mt-4" eyebrow="This session" title="Your decisions">
          <div className="space-y-2">
            {recentDecisions.map(([id, decision]) => (
              <div key={id} className="flex items-center gap-3">
                <StatusPill
                  tone={decision.decision === "approve" ? "live" : "error"}
                >
                  {decision.decision === "approve" ? "approved" : "rejected"}
                </StatusPill>

                <span className="mono truncate text-[10px] text-slate-500">
                  {id}
                </span>

                <span className="mono ml-auto text-[9px] text-slate-600">
                  {formatRelativeTime(decision.at)}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[10.5px] leading-[1.6] text-slate-500">
            Decisions are durable — the full record, including who resolved each
            one, is in Activity.
          </p>
        </Panel>
      )}
    </div>
  );
}
