import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchPendingApprovals,
  formatRelativeTime,
  resolveApproval,
  type ApprovalItem,
} from "../lib/api";

import { useCan } from "../lib/access";
import { useResource } from "../lib/useResource";

import {
  Connecting,
  Failure,
  PageOpening,
  Quiet,
  Reading,
  StatusPill,
} from "../components/primitives";

import { spellOut } from "../lib/statement";

export default function Approvals() {
  // Deciding is offered to whoever may decide; a step a governance policy
  // requires is offered only to owners and admins. The server rules either way.
  const canDecide = useCan("approvals.decide");
  const canDecideGoverned = useCan("policies.manage");

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
      await resolveApproval(approval.id, decision);
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
      {/* Red is earned here and nowhere else on this page. An empty queue is a
          good outcome, so it is stated calmly rather than dressed as an
          all-clear siren. */}
      <PageOpening
        eyebrow="Work"
        title={pending.length === 0 ? "NOTHING IS" : "THE COMPANY"}
        lead={
          pending.length === 0
            ? "WAITING ON YOU."
            : pending.length === 1
              ? "HAS STOPPED."
              : `HAS STOPPED ${spellOut(pending.length)} TIMES.`
        }
        detail="A step stops here when one of your rules requires a person, or when the planner judged it consequential. The company will not take these steps on its own."
        tone={pending.length > 0 ? "waiting" : "quiet"}
        meta={
          <Reading
            label="Awaiting a decision"
            value={approvals.loading ? "—" : pending.length}
            tone="warning"
            live={pending.length > 0}
          />
        }
      />

      {error && (
        <div className="mb-5">
          <Failure
            headline="That decision was not recorded"
            detail={error}
            consequence="The task is still waiting. Try again."
          />
        </div>
      )}

      {approvals.loading ? (
        <Connecting what="Checking what needs you…" />
      ) : approvals.error ? (
        <Failure
          headline={
            approvals.error.isOffline
              ? "The company is unreachable"
              : "The queue could not be read"
          }
          detail={approvals.error.message}
          consequence="Anything waiting stays waiting; nothing expires because this page could not load."
          action={
            <button
              type="button"
              onClick={approvals.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      ) : pending.length === 0 ? (
        <Quiet
          line="Nothing needs your decision."
          detail="A mission runs unattended until the planner flags a task as consequential. When it does, the task stops here and the whole product turns red until you answer."
          action={
            <Link to="/missions" className="button-ghost">
              See what is running
            </Link>
          }
        />
      ) : (
        <div className="divide-y divide-line-subtle border-t border-line-subtle">
          {pending.map((approval) => (
            <div key={approval.id} className="approval-row">
              <div className="approval-row-head">
                <span className="approval-marker" aria-hidden="true" />

                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold leading-snug tracking-[-0.018em] text-ink-primary">
                    {approval.action}
                  </div>

                  <div className="t-machine mt-1.5">{approval.resource}</div>
                </div>

                <StatusPill tone="warning" pulse>
                  {approval.status}
                </StatusPill>
              </div>

              <dl className="approval-facts">
                <div>
                  <dt className="t-eyebrow">Why it stopped</dt>
                  <dd className="mt-1.5 text-[11.5px] leading-[1.65] text-ink-secondary">
                    {approval.reason}
                  </dd>
                </div>

                <div>
                  <dt className="t-eyebrow">If you approve</dt>
                  <dd className="mt-1.5 text-[11.5px] leading-[1.65] text-ink-secondary">
                    The task goes onto the durable queue, a worker picks it up,
                    and everything depending on it continues.
                  </dd>
                </div>

                <div>
                  <dt className="t-eyebrow">If you reject</dt>
                  <dd className="mt-1.5 text-[11.5px] leading-[1.65] text-ink-secondary">
                    The decision is recorded against the run and the task stays
                    unexecuted. Nothing is deleted.
                  </dd>
                </div>
              </dl>

              <div className="approval-row-foot">
                <span className="t-machine">
                  requested {formatRelativeTime(approval.createdAt)}
                </span>

                <Link to={`/missions/${approval.workId}`} className="button-quiet">
                  Open the mission
                </Link>

                <span className="flex-1" />

                {!canDecide ? (
                  <span className="t-meta">Your role can see this step but not decide it.</span>
                ) : typeof approval.metadata.policyId === "string" && !canDecideGoverned ? (
                  <span className="t-meta">A governance policy requires an owner or admin to decide this step.</span>
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {recentDecisions.length > 0 && (
        <section className="mt-10">
          <div className="section-head">
            <div className="section-head-title">
              Decided in this session
              <span className="section-head-count">
                {recentDecisions.length}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            {recentDecisions.map(([id, decision]) => (
              <div key={id} className="flex items-center gap-3">
                <StatusPill
                  tone={decision.decision === "approve" ? "live" : "error"}
                >
                  {decision.decision === "approve" ? "approved" : "rejected"}
                </StatusPill>

                <span className="mono truncate text-[10px] text-ink-faint">
                  {id}
                </span>

                <span className="mono ml-auto text-[9px] text-ink-ghost">
                  {formatRelativeTime(decision.at)}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-5 max-w-[62ch] text-[10.5px] leading-[1.7] text-ink-faint">
            Decisions are durable. This list is only what you did since the page
            loaded — the permanent record, including who resolved each one, is
            in Activity.
          </p>
        </section>
      )}
    </div>
  );
}
