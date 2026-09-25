import { useCallback, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchPendingApprovals,
  formatRelativeTime,
  resolveApproval,
  type ApprovalBriefing,
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

/** Why a person is needed, in the words someone deciding would use. */
const REQUESTED_BY: Record<ApprovalBriefing["requestedBy"], (briefing: ApprovalBriefing) => string> = {
  external_write: (briefing) => `It changes something outside the company (${briefing.externalWrites.join(", ")}), which always needs an owner or admin.`,
  skill: (briefing) => `The ${briefing.skill ?? "skill"} skill is set to need a person for every step.`,
  policy: (briefing) => `Required by the policy ${briefing.policy?.name ?? "a policy"}.`,
  planner: () => "The planner judged this step consequential enough to ask.",
};

export default function Approvals() {
  // Deciding is offered to whoever may decide; a step a governance policy
  // requires is offered only to owners and admins. The server rules either way.
  const canDecide = useCan("approvals.decide");
  const canDecideGoverned = useCan("policies.manage");

  const approvals = useResource<Array<ApprovalItem & { briefing?: ApprovalBriefing }>>(
    useCallback(() => fetchPendingApprovals(), []),
    { pollMs: 15_000 },
  );

  const [resolving, setResolving] = useState<{ id: string; decision: "approve" | "reject" }>();
  const [error, setError] = useState<string>();
  // What was decided here, named the way the card named it. The record keeps
  // the step's title rather than the approval's id: an id is how the server
  // finds a decision, not how a person recognises one.
  const [resolved, setResolved] = useState<
    Record<string, { decision: "approve" | "reject"; at: string; title: string; mission?: string }>
  >({});

  async function decide(
    approval: ApprovalItem & { briefing?: ApprovalBriefing },
    decision: "approve" | "reject",
  ) {
    setResolving({ id: approval.id, decision });
    setError(undefined);

    try {
      await resolveApproval(approval.id, decision);
      setResolved((current) => ({
        ...current,
        [approval.id]: {
          decision,
          at: new Date().toISOString(),
          title: approval.briefing?.step?.title ?? approval.action,
          mission: approval.briefing?.mission?.objective,
        },
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
        <div className="approval-stack stagger">
          {pending.map((approval) => {
            const briefing = approval.briefing;
            // The server says who may decide; without a briefing (an older
            // API) the page falls back to the role it can see.
            const decidable = briefing
              ? briefing.youCanDecide
              : canDecide && (typeof approval.metadata.policyId !== "string" || canDecideGoverned);

            return (
              <article key={approval.id} className="approval-row" aria-label={briefing?.step?.title ?? approval.action}>
                <div className="approval-row-head">
                  <span className="approval-marker" aria-hidden="true" />

                  <div className="min-w-0 flex-1">
                    <div className="text-(length:--text-lg) font-semibold leading-snug tracking-[-0.018em] text-ink-primary">
                      {briefing?.step?.title ?? approval.action}
                    </div>

                    <div className="t-meta mt-1.5">
                      {briefing?.agent ? `${briefing.agent.name} is waiting` : "An agent is waiting"}
                      {briefing?.mission && ` · ${briefing.mission.objective}`}
                      {briefing?.mission?.workspace && ` · ${briefing.mission.workspace}`}
                    </div>
                  </div>

                  {briefing?.risk && <StatusPill tone={briefing.risk === "low" ? "idle" : "warning"}>{briefing.risk} risk</StatusPill>}
                  <StatusPill tone="warning" pulse>
                    {approval.status}
                  </StatusPill>
                </div>

                {briefing?.proposal && (
                  <div className="approval-proposal">
                    <span className="t-eyebrow">What you are approving</span>
                    <p className="approval-proposal-summary">{briefing.proposal.summary}</p>
                    {briefing.proposal.skill && (
                      <p className="approval-proposal-skill">
                        {briefing.proposal.skill.name}, version {briefing.proposal.skill.version}
                      </p>
                    )}
                    <p className="approval-proposal-bound">
                      This decision covers exactly this. If the step changes before it runs, it comes back to you.
                    </p>
                  </div>
                )}

                <dl className="approval-facts">
                  <div>
                    <dt className="t-eyebrow">Why it stopped</dt>
                    <dd className="mt-1.5 text-(length:--text-sm) leading-[1.65] text-ink-secondary">
                      {approval.reason}
                      {briefing && <span className="mt-1.5 block text-ink-muted">{REQUESTED_BY[briefing.requestedBy](briefing)}</span>}
                    </dd>
                  </div>

                  <div className="approval-if-approve">
                    <dt className="t-eyebrow">If you approve</dt>
                    <dd className="mt-1.5 text-(length:--text-sm) leading-[1.65] text-ink-secondary">
                      {briefing?.onApprove ??
                        "The task goes onto the durable queue, a worker picks it up, and everything depending on it continues."}
                    </dd>
                  </div>

                  <div className="approval-if-reject">
                    <dt className="t-eyebrow">If you reject</dt>
                    <dd className="mt-1.5 text-(length:--text-sm) leading-[1.65] text-ink-secondary">
                      {briefing?.onReject ??
                        "The decision is recorded against the run and the task stays unexecuted. Nothing is deleted."}
                    </dd>
                  </div>
                </dl>

                {briefing && (briefing.step?.description || briefing.tools.length > 0) && (
                  <div className="approval-involves">
                    <span className="t-eyebrow">What it involves</span>
                    {briefing.step?.description && <p className="t-body mt-1.5">{briefing.step.description}</p>}
                    {briefing.tools.length > 0 && (
                      <div className="token-set">
                        {briefing.tools.map((tool) => (
                          <span key={tool} className={`token ${briefing.externalWrites.includes(tool) ? "token-unknown" : "token-tool"}`}>
                            {tool}{briefing.externalWrites.includes(tool) ? " · changes an outside system" : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="approval-row-foot">
                  <span className="t-machine">
                    requested {formatRelativeTime(approval.createdAt)}
                  </span>

                  <Link to={`/missions/${approval.workId}`} className="button-quiet">
                    View the mission
                  </Link>

                  <span className="flex-1" />

                  {!decidable ? (
                    <span className="t-meta">
                      {!canDecide
                        ? "Your role can see this step but not decide it."
                        : briefing?.decidedBy === "owners_and_admins" && briefing.requestedBy !== "policy"
                          ? "An owner or admin decides this step."
                          : "A governance policy requires an owner or admin to decide this step."}
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={resolving?.id === approval.id}
                        onClick={() => decide(approval, "reject")}
                        className="button-ghost button-reject approval-reject"
                      >
                        {resolving?.id === approval.id && resolving.decision === "reject" ? "Rejecting…" : "Reject"}
                      </button>

                      <button
                        type="button"
                        disabled={resolving?.id === approval.id}
                        onClick={() => decide(approval, "approve")}
                        className="button-primary button-approve-strong approval-approve"
                      >
                        {resolving?.id === approval.id && resolving.decision === "approve"
                          ? "Approving…"
                          : "Approve and continue"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
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

          <div className="decided-list stagger">
            {recentDecisions.map(([id, decision]) => (
              <div key={id} className={`decided-line decided-${decision.decision}`}>
                <StatusPill
                  tone={decision.decision === "approve" ? "live" : "error"}
                >
                  {decision.decision === "approve" ? "approved" : "rejected"}
                </StatusPill>

                <span className="min-w-0 flex-1">
                  <span className="decided-title">{decision.title}</span>
                  {decision.mission && <span className="decided-mission">{decision.mission}</span>}
                </span>

                <span className="t-machine shrink-0">
                  {formatRelativeTime(decision.at)}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-5 max-w-[62ch] text-(length:--text-xs) leading-[1.7] text-ink-faint">
            Decisions are durable. This list is only what you did since the page
            loaded — the permanent record, including who resolved each one, is
            in Activity.
          </p>
        </section>
      )}
    </div>
  );
}
