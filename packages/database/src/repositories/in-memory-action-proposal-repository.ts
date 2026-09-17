import type {
  ActionProposal,
  ActionProposalId,
  OrganizationId,
  TaskId,
} from "@unioffice/core";

import type { ActionProposalRepository } from "./action-proposal-repository.js";

/** Proposals without a database, with the same write-once behaviour. */
export class InMemoryActionProposalRepository implements ActionProposalRepository {
  readonly proposals = new Map<ActionProposalId, ActionProposal>();

  async create(proposal: ActionProposal): Promise<ActionProposal> {
    if (this.proposals.has(proposal.id)) {
      throw new Error(`Proposal already exists: ${proposal.id}`);
    }

    this.proposals.set(proposal.id, structuredClone(proposal));
    return structuredClone(proposal);
  }

  async findById(id: ActionProposalId, organizationId: OrganizationId): Promise<ActionProposal | null> {
    const proposal = this.proposals.get(id);

    return proposal && proposal.organizationId === organizationId
      ? structuredClone(proposal)
      : null;
  }

  async findByTask(taskId: TaskId): Promise<ActionProposal[]> {
    return [...this.proposals.values()]
      .filter((proposal) => proposal.taskId === taskId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((proposal) => structuredClone(proposal));
  }
}
