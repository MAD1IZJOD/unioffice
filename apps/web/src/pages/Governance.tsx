import { ArrowRight, Plus, ShieldAlert } from "lucide-react";

import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  createPolicy,
  fetchAgents,
  fetchGovernance,
  fetchTools,
  fetchWorkspaces,
  updatePolicy,
  type AgentSummary,
  type GovernanceOverview,
  type NewPolicy,
  type PolicyStatus,
  type ToolDescriptor,
  type WorkspaceSummary,
} from "../lib/api";

import { useLiveResource } from "../lib/live";
import { useResource } from "../lib/useResource";

import { orderPolicies } from "../lib/governance";

import {
  Chapter,
  Connecting,
  Failure,
  Quiet,
} from "../components/primitives";

import { AuditTrail } from "../components/governance/AuditTrail";
import { PolicyCard } from "../components/governance/PolicyCard";
import { PolicyComposer } from "../components/governance/PolicyComposer";
import {
  GovernedTools,
  GovernedWorkforce,
} from "../components/governance/GovernedWorkforce";

/**
 * The Governance Center.
 *
 * UNI-OFFICE acts on its own. This is where a person decides what it is
 * allowed to do on its own, and the whole surface is arranged around that one
 * distinction: rules first, then who they constrain, then what they actually
 * stopped.
 *
 * Every number is counted from a row that exists. There is deliberately no
 * compliance score and no coverage percentage - a control surface that
 * invents reassurance is worse than one that says plainly that a company has
 * written no rules yet.
 */
export default function Governance() {
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composeError, setComposeError] = useState<string>();
  const [actionError, setActionError] = useState<string>();

  const governance = useLiveResource<GovernanceOverview>(
    useCallback(() => fetchGovernance(200), []),
    { fallbackPollMs: 20_000 },
  );

  // Reference data for the composer. It does not move, so it is read once and
  // not put on the live channel.
  const agents = useResource<AgentSummary[]>(
    useCallback(() => fetchAgents(), []),
  );
  const tools = useResource<ToolDescriptor[]>(
    useCallback(() => fetchTools(), []),
  );
  const workspaces = useResource<WorkspaceSummary[]>(
    useCallback(() => fetchWorkspaces(), []),
  );

  const { reload } = governance;

  const agentNames = useCallback(
    (ids: string[]) =>
      ids.map(
        (id) => agents.data?.find((agent) => agent.id === id)?.name ?? id,
      ),
    [agents.data],
  );

  async function write(policy: NewPolicy) {
    setBusy(true);
    setComposeError(undefined);

    try {
      await createPolicy(policy);
      setComposing(false);
      reload();
    } catch (error) {
      setComposeError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function move(policyId: string, status: PolicyStatus) {
    setBusy(true);
    setActionError(undefined);

    try {
      await updatePolicy(policyId, { status });
      reload();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const data = governance.data;
  const policies = useMemo(
    () => orderPolicies(data?.policies ?? []),
    [data?.policies],
  );

  if (governance.error) {
    return (
      <div className="mx-auto max-w-[1340px] pt-6">
        <Failure
          headline={
            governance.error.isOffline
              ? "Governance is unreachable"
              : "That read failed"
          }
          detail={governance.error.message}
          consequence={
            governance.error.isOffline
              ? "The rules themselves are unaffected — they are enforced inside execution, not by this page."
              : "Nothing was changed by this request."
          }
          action={
            <button
              type="button"
              onClick={governance.reload}
              className="button-ghost"
            >
              Try again
            </button>
          }
        />
      </div>
    );
  }

  const counts = data?.counts;
  const nothingWritten = Boolean(data) && policies.length === 0;

  return (
    <div className="control fade-up">
      {/* The opening. The company's autonomy and the person's authority over
          it, stated as the two halves of one sentence. */}
      <header
        className={`control-open${counts?.active ? " control-open-live" : ""}`}
      >
        <div className="control-open-inner">
          <div className="control-eyebrow">
            <span>Governance</span>
            <span>{counts?.active ?? 0} rules being enforced</span>
          </div>

          <h2 className="control-statement">
            <span className="control-statement-line">The company acts</span>
            <span className="control-statement-line control-statement-accent">
              on its own.
            </span>
            <span className="control-statement-line">
              You decide what it may do
            </span>
            <span className="control-statement-line">without asking.</span>
          </h2>

          <p className="control-lead">
            Every step and every tool call is checked against these rules
            before it runs. The check happens inside execution, in the backend,
            and it is the same answer every time — no model is asked whether
            something is permitted.
          </p>

          <div className="control-readout">
            <Reading
              label="Enforced"
              value={counts ? counts.active : "—"}
              live={Boolean(counts?.active)}
            />
            <Reading
              label="Never permitted"
              value={counts ? counts.denying : "—"}
              tone="error"
              live={Boolean(counts?.denying)}
            />
            <Reading
              label="Needs a person"
              value={counts ? counts.gating : "—"}
              tone="warning"
              live={Boolean(counts?.gating)}
            />
            <Reading
              label="Agents covered"
              value={counts ? counts.agentsGoverned : "—"}
            />
            <Reading
              label="Blocked recently"
              value={counts ? counts.deniedRecently : "—"}
              tone="error"
              live={Boolean(counts?.deniedRecently)}
            />
            <Reading
              label="Waiting on you"
              value={counts ? counts.pendingApprovals : "—"}
              tone="warning"
              live={Boolean(counts?.pendingApprovals)}
            />
          </div>

          {Boolean(counts?.pendingApprovals) && (
            <Link to="/approvals" className="control-attention">
              <ShieldAlert size={14} />
              <span>
                {counts!.pendingApprovals}{" "}
                {counts!.pendingApprovals === 1 ? "decision is" : "decisions are"}{" "}
                waiting on you
              </span>
              <ArrowRight size={13} />
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1340px] pt-7">
        <Chapter
          index="01"
          title="The rules"
          action={
            !composing && (
              <button
                type="button"
                onClick={() => {
                  setComposing(true);
                  setComposeError(undefined);
                }}
                className="button-primary"
              >
                <Plus size={13} />
                Write a rule
              </button>
            )
          }
        />

        {composing && (
          <PolicyComposer
            agents={agents.data ?? []}
            tools={tools.data ?? []}
            workspaces={workspaces.data ?? []}
            busy={busy}
            error={composeError}
            onCancel={() => setComposing(false)}
            onCreate={write}
          />
        )}

        {actionError && (
          <div className="mb-4">
            <Failure
              headline="That did not go through"
              detail={actionError}
              consequence="Nothing was changed. The company is governed exactly as it was."
            />
          </div>
        )}

        {governance.loading ? (
          <Connecting what="Reading the rules…" />
        ) : nothingWritten && !composing ? (
          <Quiet
            line="The company is running unconstrained."
            detail="Nothing has been written down, so every step and every tool call is permitted. Write a rule and it is applied to the very next thing the company does."
          />
        ) : (
          <div className="policy-list">
            {policies.map((policy) => (
              <PolicyCard
                key={policy.id}
                policy={policy}
                agentNames={agentNames}
                busy={busy}
                onChangeStatus={(status) => move(policy.id, status)}
              />
            ))}
          </div>
        )}

        <Chapter
          index="02"
          title="Who they constrain"
          action={
            <Link to="/agents" className="button-quiet">
              The roster
            </Link>
          }
        />

        {governance.loading ? (
          <Connecting what="Working out what each agent may do…" />
        ) : (
          <GovernedWorkforce agents={data?.agents ?? []} />
        )}

        <Chapter
          index="03"
          title="What they can reach"
          action={
            <Link to="/tools" className="button-quiet">
              Every tool
            </Link>
          }
        />

        {governance.loading ? (
          <Connecting what="Reading the tool registry…" />
        ) : (
          <GovernedTools tools={data?.tools ?? []} />
        )}

        <Chapter
          index="04"
          title="What actually happened"
          action={
            <span className="t-machine">
              {data?.decisions.length ?? 0} recorded
            </span>
          }
        />

        {governance.loading ? (
          <Connecting what="Reading the decisions…" />
        ) : (
          <AuditTrail decisions={data?.decisions ?? []} />
        )}
      </div>
    </div>
  );
}

function Reading({
  label,
  value,
  tone = "idle",
  live = false,
}: {
  label: string;
  value: number | string;
  tone?: "idle" | "error" | "warning";
  live?: boolean;
}) {
  return (
    <div className={`control-reading control-reading-${tone}`}>
      <div
        className={`control-reading-value${live ? " control-reading-live" : ""}`}
      >
        {value}
      </div>
      <div className="control-reading-label">{label}</div>
    </div>
  );
}
