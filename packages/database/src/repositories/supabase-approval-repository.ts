import type {
  ApprovalId,
  ApprovalRequest,
  AgentId,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApprovalRepository } from "./approval-repository.js";

interface ApprovalRow {
  id: string;
  organization_id: string;
  work_id: string;
  task_id: string;
  agent_id: string | null;
  action: string;
  resource: string;
  reason: string;
  status: ApprovalRequest["status"];
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  metadata: Record<string, unknown> | null;
}

export class SupabaseApprovalRepository implements ApprovalRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(approval: ApprovalRequest): Promise<ApprovalRequest> {
    const { data, error } = await this.client
      .from("approval_requests")
      .insert(toRow(approval))
      .select()
      .single();

    if (error) throw new Error(`Failed to create approval: ${error.message}`);
    return fromRow(data as ApprovalRow);
  }

  async findById(id: ApprovalId): Promise<ApprovalRequest | null> {
    const { data, error } = await this.client
      .from("approval_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find approval: ${error.message}`);
    return data ? fromRow(data as ApprovalRow) : null;
  }

  async findByWork(workId: WorkId): Promise<ApprovalRequest[]> {
    const { data, error } = await this.client
      .from("approval_requests")
      .select("*")
      .eq("work_id", workId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to find work approvals: ${error.message}`);
    return (data as ApprovalRow[] ?? []).map(fromRow);
  }

  async findPendingByOrganization(
    organizationId: OrganizationId,
  ): Promise<ApprovalRequest[]> {
    const { data, error } = await this.client
      .from("approval_requests")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to find pending approvals: ${error.message}`);
    return (data as ApprovalRow[] ?? []).map(fromRow);
  }

  async update(approval: ApprovalRequest): Promise<ApprovalRequest> {
    const { data, error } = await this.client
      .from("approval_requests")
      .update(toRow(approval))
      .eq("id", approval.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update approval: ${error.message}`);
    return fromRow(data as ApprovalRow);
  }

  async resolvePending(
    approval: ApprovalRequest,
  ): Promise<ApprovalRequest | null> {
    // The `status = pending` predicate is evaluated by Postgres inside the same
    // statement that writes the decision, so concurrent deciders contend on the
    // row lock and exactly one of them matches a row.
    const { data, error } = await this.client
      .from("approval_requests")
      .update(toRow(approval))
      .eq("id", approval.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (error) throw new Error(`Failed to resolve approval: ${error.message}`);
    return data ? fromRow(data as ApprovalRow) : null;
  }
}

function toRow(approval: ApprovalRequest) {
  return {
    id: approval.id,
    organization_id: approval.organizationId,
    work_id: approval.workId,
    task_id: approval.taskId,
    agent_id: approval.agentId ?? null,
    action: approval.action,
    resource: approval.resource,
    reason: approval.reason,
    status: approval.status,
    created_at: approval.createdAt.toISOString(),
    resolved_at: approval.resolvedAt?.toISOString() ?? null,
    resolved_by: approval.resolvedBy ?? null,
    metadata: approval.metadata,
  };
}

function fromRow(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id as ApprovalId,
    organizationId: row.organization_id as OrganizationId,
    workId: row.work_id as WorkId,
    taskId: row.task_id as TaskId,
    agentId: row.agent_id ? (row.agent_id as AgentId) : undefined,
    action: row.action,
    resource: row.resource,
    reason: row.reason,
    status: row.status,
    createdAt: new Date(row.created_at),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    resolvedBy: row.resolved_by ?? undefined,
    metadata: row.metadata ?? {},
  };
}
