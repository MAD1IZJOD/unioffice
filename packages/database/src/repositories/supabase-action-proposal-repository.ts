import type {
  ActionProposal,
  ActionProposalId,
  AgentId,
  OrganizationId,
  ProposedAction,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ActionProposalRepository } from "./action-proposal-repository.js";

interface ProposalRow {
  id: string;
  organization_id: string;
  work_id: string;
  task_id: string;
  agent_id: string | null;
  summary: string;
  action: ProposedAction;
  hash: string;
  created_at: string;
}

const COLUMNS = "id,organization_id,work_id,task_id,agent_id,summary,action,hash,created_at";

export class SupabaseActionProposalRepository implements ActionProposalRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(proposal: ActionProposal): Promise<ActionProposal> {
    const { data, error } = await this.client
      .from("action_proposals")
      .insert({
        id: proposal.id,
        organization_id: proposal.organizationId,
        work_id: proposal.workId,
        task_id: proposal.taskId,
        agent_id: proposal.agentId ?? null,
        summary: proposal.summary,
        action: proposal.action,
        hash: proposal.hash,
      })
      .select(COLUMNS)
      .single();

    if (error) throw new Error(`Failed to record proposal: ${error.message}`);
    return toProposal(data as ProposalRow);
  }

  async findById(id: ActionProposalId, organizationId: OrganizationId): Promise<ActionProposal | null> {
    const { data, error } = await this.client
      .from("action_proposals")
      .select(COLUMNS)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) throw new Error(`Failed to read proposal: ${error.message}`);
    return data ? toProposal(data as ProposalRow) : null;
  }

  async findByTask(taskId: TaskId): Promise<ActionProposal[]> {
    const { data, error } = await this.client
      .from("action_proposals")
      .select(COLUMNS)
      .eq("task_id", taskId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(`Failed to read proposals: ${error.message}`);
    return ((data ?? []) as ProposalRow[]).map(toProposal);
  }
}

function toProposal(row: ProposalRow): ActionProposal {
  return {
    id: row.id as ActionProposalId,
    organizationId: row.organization_id as OrganizationId,
    workId: row.work_id as WorkId,
    taskId: row.task_id as TaskId,
    agentId: (row.agent_id ?? undefined) as AgentId | undefined,
    summary: row.summary,
    action: row.action,
    hash: row.hash,
    createdAt: new Date(row.created_at),
  };
}
