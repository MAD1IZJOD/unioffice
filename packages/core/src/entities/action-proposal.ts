import { createHash } from "node:crypto";

import type {
  ActionProposalId,
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
} from "../types/ids.js";

/**
 * Exactly what a step would do, written down before anyone is asked to allow
 * it.
 *
 * An approval is granted against one of these, not against a step in the
 * abstract: "Ledger will run Financial analysis version 3 on the Q3 expenses,
 * using the calculator" is a thing a person can agree to. A step in the
 * abstract is not.
 *
 * A proposal is never edited. When what the step would do changes - a
 * different agent, a different skill or version, different tools - that is a
 * different proposal, and the approval given for the old one does not carry
 * over to it. `hash` is what makes that check cheap and exact.
 */
export interface ActionProposal {
  id: ActionProposalId;
  organizationId: OrganizationId;
  workId: WorkId;
  taskId: TaskId;

  /** Who would do it. */
  agentId?: AgentId;

  /** One sentence naming what would happen, in a person's words. */
  summary: string;

  /** The action itself, field by field. Everything the hash covers. */
  action: ProposedAction;

  /** A fingerprint of `action`. What an approval is bound to. */
  hash: string;

  createdAt: Date;
}

/**
 * What would be done. Only what is settled before the step runs: who, which
 * procedure, which tools, and against what. Never a prompt, never credentials,
 * never anything a model has yet to produce.
 */
export interface ProposedAction {
  /** The step, as it is written now. */
  step: { title: string; description: string };

  /** The agent the step is assigned to, by name so an approval can be read. */
  agent?: { id: string; name: string };

  /** The skill and the exact version the step is pinned to. */
  skill?: { ref: string; slug: string; name: string; version: number };

  /** Every tool the step is authorized to use. */
  tools: string[];

  /**
   * The tools among those that write to systems outside the company's own
   * records. These are the part of an approval that cannot be undone.
   */
  externalWrites: string[];

  /** The mission this step belongs to, in its own words. */
  objective: string;
}

/**
 * The fingerprint of an action.
 *
 * Fields in a fixed order and lists sorted, so the same action always hashes
 * the same way and a different action never hashes the same as this one. This
 * is a check for change, not a secret: it defends against a step quietly
 * becoming a different step between being approved and being run, which is
 * the thing an approval cannot survive.
 */
export function hashProposedAction(action: ProposedAction): string {
  const canonical = JSON.stringify([
    action.step.title,
    action.step.description,
    action.agent?.id ?? "",
    action.skill ? [action.skill.ref, action.skill.version] : "",
    [...action.tools].sort(),
    [...action.externalWrites].sort(),
    action.objective,
  ]);

  return createHash("sha256").update(canonical).digest("hex");
}

/** Whether an action is the same one a person approved. */
export function matchesProposal(proposal: Pick<ActionProposal, "hash">, action: ProposedAction): boolean {
  return hashProposedAction(action) === proposal.hash;
}
