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
  PageOpening,
  Reading,
  ErrorState,
  Panel,
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
      <PageOpening
        eyebrow="Operate"
        title={pending.length === 0 ? "NOTHING IS" : "THE COMPANY"}
        lead={pending.length === 0 ? "WAITING ON YOU." : "HAS STOPPED."}
        detail="Tasks the planner marked as consequential stop here. The company will not take these steps without a person."
        tone={pending.length > 0 ? "waiting" : "quiet"}
        meta={<Reading label="Awaiting a decision" value={approvals.loading ? "—" : pending.length} tone="warning" live={pending.length > 0} />}
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
          <div className="divide-y divide-[#161a21]">
            {pending.map((approval) => (
              <div key={approval.id} className="approval-row">
                <div className="approval-row-head">
                  <span className="approval-marker" aria-hidden="true" />

                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold leading-snug text-[#f2f4f7]">
                      {approval.action}
                    </div>

                    <div className="t-machine mt-1">{approval.resource}</div>
                  </div>

                  <StatusPill tone="warning" pulse>
                    {approval.status}
                  </StatusPill>
                </div>

                <dl className="approval-facts">
                  <div>
                    <dt className="t-eyebrow">Why it stopped</dt>
                    <dd className="mt-1.5 text-[11.5px] leading-[1.6] text-[#a7b0bd]">
                      {approval.reason}
                    </dd>
                  </div>

                  <div>
                    <dt className="t-eyebrow">If you approve</dt>
                    <dd className="mt-1.5 text-[11.5px] leading-[1.6] text-[#a7b0bd]">
                      This task is queued for a worker, and everything
                      depending on it continues.
                    </dd>
                  </div>

                  <div>
                    <dt className="t-eyebrow">If you reject</dt>
                    <dd className="mt-1.5 text-[11.5px] leading-[1.6] text-[#a7b0bd]">
                      The decision is recorded and the task stays unexecuted.
                    </dd>
                  </div>
                </dl>

                <div className="approval-row-foot">
                  <span className="t-machine">
                    requested {formatRelativeTime(approval.createdAt)}
                  </span>

                  <Link
                    to={`/work/${approval.workId}`}
                    className="button-quiet"
                  >
                    Open the work
                  </Link>

                  <span className="flex-1" />

                  <button
                    type="button"
                    disabled={resolving === approval.id}
                    onClick={() => decide(approval, "reject")}
                    className="button-ghost button-reject"
                  >
                    Reject
                  </button>

                  <button
                    type="button"
                    disabled={resolving === approval.id}
                    onClick={() => decide(approval, "approve")}
                    className="button-primary button-approve-strong"
                  >
                    {resolving === approval.id
                      ? "Working…"
                      : "Approve and continue"}
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
