import type {
  ActionProposal,
  ActionProposalId,
  OrganizationId,
  TaskId,
} from "@unioffice/core";

/**
 * Proposals: what a step would do, as it was put in front of a person.
 *
 * Nothing here updates. A changed action is a new proposal, so what someone
 * approved stays readable exactly as they saw it, however much the step has
 * moved on since.
 */
export interface ActionProposalRepository {
  create(proposal: ActionProposal): Promise<ActionProposal>;

  findById(id: ActionProposalId, organizationId: OrganizationId): Promise<ActionProposal | null>;

  /** Every proposal written for one step, newest first. */
  findByTask(taskId: TaskId): Promise<ActionProposal[]>;
}
