import { ChevronDown } from "lucide-react";

import { useState } from "react";

import {
  formatRelativeTime,
  type PolicyItem,
  type PolicyStatus,
} from "../../lib/api";

import {
  effectLabel,
  effectTone,
  policySentence,
  riskTone,
  scopeSentence,
  statusTone,
  subjectLabel,
} from "../../lib/governance";

import { toneClass } from "../../lib/tone";
import { Chip, StatusPill } from "../primitives";

/**
 * One rule.
 *
 * Readable closed: what it covers and what it does, in a sentence built from
 * the same fields the engine matches on - so what a person reads here is what
 * the backend will actually do, not a summary that can drift from it.
 *
 * The lifecycle controls are the only place a rule starts or stops
 * constraining real execution, so they say what will happen rather than
 * naming a state: "Start enforcing", not "Set active".
 */
export function PolicyCard({
  policy,
  agentNames,
  busy,
  onChangeStatus,
}: {
  policy: PolicyItem;
  /** Resolves the agent ids in scope to names. */
  agentNames: (ids: string[]) => string[];
  busy: boolean;
  onChangeStatus: (status: PolicyStatus) => void;
}) {
  const [open, setOpen] = useState(false);

  const enforced = policy.status === "active";
  const named = agentNames(policy.scope.agentIds);

  return (
    <article
      className={`policy ${toneClass[effectTone(policy.effect)]}${
        enforced ? " policy-live" : ""
      }`}
    >
      <button
        type="button"
        className="policy-head"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="policy-rail" aria-hidden="true" />

        <span className="min-w-0 flex-1">
          <span className="policy-name-row">
            <span className="policy-name">{policy.name}</span>

            <StatusPill tone={statusTone(policy.status)} pulse={enforced}>
              {policy.status}
            </StatusPill>
          </span>

          {/* The whole rule in one line. This is the thing that makes a
              policy understandable without opening it. */}
          <span className="policy-sentence">{policySentence(policy)}</span>

          <span className="policy-facts">
            <Chip tone={effectTone(policy.effect)}>
              {effectLabel(policy.effect)}
            </Chip>
            <Chip tone={riskTone(policy.risk)}>{policy.risk} risk</Chip>
            <span className="t-machine">{subjectLabel(policy)}</span>
          </span>
        </span>

        <ChevronDown
          size={14}
          className={`policy-chevron${open ? " policy-chevron-open" : ""}`}
        />
      </button>

      {open && (
        <div className="policy-body">
          {policy.description && (
            <p className="policy-description">{policy.description}</p>
          )}

          <dl className="policy-detail">
            <Detail label="Covers">{scopeSentence(policy)}</Detail>

            {named.length > 0 && (
              <Detail label="Agents">{named.join(", ")}</Detail>
            )}

            {policy.scope.toolIds.length > 0 && (
              <Detail label="Tools">{policy.scope.toolIds.join(", ")}</Detail>
            )}

            {policy.scope.capabilities.length > 0 && (
              <Detail label="Disciplines">
                {policy.scope.capabilities
                  .map((capability) => capability.replace(/_/g, " "))
                  .join(", ")}
              </Detail>
            )}

            {policy.effect === "require_approval" && (
              <Detail label="Asks">
                {policy.approvalPrompt || policy.description ||
                  "A person has to approve this before it runs."}
              </Detail>
            )}

            <Detail label="Written">
              {formatRelativeTime(policy.createdAt)}
              {policy.createdBy ? ` by ${policy.createdBy}` : ""}
            </Detail>
          </dl>

          <div className="policy-actions">
            {policy.status !== "active" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onChangeStatus("active")}
                className="button-primary"
              >
                Start enforcing
              </button>
            )}

            {policy.status === "active" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onChangeStatus("paused")}
                className="button-ghost"
              >
                Stop enforcing
              </button>
            )}

            {policy.status !== "archived" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onChangeStatus("archived")}
                className="button-quiet"
              >
                Retire it
              </button>
            )}
          </div>

          {enforced && (
            <p className="policy-live-note">
              This rule is being applied right now, to every step and every
              tool call it covers.
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="policy-detail-row">
      <dt className="policy-detail-label">{label}</dt>
      <dd className="policy-detail-value">{children}</dd>
    </div>
  );
}
