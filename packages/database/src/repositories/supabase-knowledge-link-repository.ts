import type {
  AgentId,
  KnowledgeConflict,
  KnowledgeConflictId,
  KnowledgeConflictStatus,
  KnowledgeRecall,
  KnowledgeRecallId,
  MemoryId,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  KnowledgeConflictQuery,
  KnowledgeLinkRepository,
} from "./knowledge-repository.js";

interface RecallRow {
  id: string;
  organization_id: string;
  memory_id: string;
  work_id: string | null;
  task_id: string | null;
  agent_id: string | null;
  stage: "planning" | "execution";
  rank: number;
  score: number;
  reasons: unknown;
  recalled_at: string;
}

interface ConflictRow {
  id: string;
  organization_id: string;
  memory_id: string;
  conflicting_memory_id: string;
  reason: string;
  signals: Record<string, unknown> | null;
  status: KnowledgeConflictStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  detected_at: string;
}

const MAX_LIMIT = 500;

export class SupabaseKnowledgeLinkRepository implements KnowledgeLinkRepository {
  constructor(private readonly client: SupabaseClient) {}

  async recordRecalls(recalls: KnowledgeRecall[]): Promise<void> {
    if (recalls.length === 0) {
      return;
    }

    const { error } = await this.client
      .from("knowledge_recalls")
      .insert(recalls.map(recallToRow));

    if (error) throw new Error(`Failed to record knowledge recalls: ${error.message}`);
  }

  async findRecallsByMemory(
    organizationId: OrganizationId,
    memoryId: MemoryId,
    limit: number,
  ): Promise<KnowledgeRecall[]> {
    const { data, error } = await this.client
      .from("knowledge_recalls")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("memory_id", memoryId)
      .order("recalled_at", { ascending: false })
      .limit(Math.min(limit, MAX_LIMIT));

    if (error) throw new Error(`Failed to read knowledge recalls: ${error.message}`);
    return ((data ?? []) as RecallRow[]).map(recallFromRow);
  }

  async findRecallsByWork(
    organizationId: OrganizationId,
    workId: WorkId,
  ): Promise<KnowledgeRecall[]> {
    const { data, error } = await this.client
      .from("knowledge_recalls")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("work_id", workId)
      .order("recalled_at", { ascending: true })
      .order("rank", { ascending: true })
      .limit(MAX_LIMIT);

    if (error) throw new Error(`Failed to read knowledge recalls: ${error.message}`);
    return ((data ?? []) as RecallRow[]).map(recallFromRow);
  }

  async findRecentRecalls(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<KnowledgeRecall[]> {
    const { data, error } = await this.client
      .from("knowledge_recalls")
      .select("*")
      .eq("organization_id", organizationId)
      .order("recalled_at", { ascending: false })
      .limit(Math.min(limit, MAX_LIMIT));

    if (error) throw new Error(`Failed to read knowledge recalls: ${error.message}`);
    return ((data ?? []) as RecallRow[]).map(recallFromRow);
  }

  async createConflict(
    conflict: KnowledgeConflict,
  ): Promise<KnowledgeConflict | null> {
    const { data, error } = await this.client
      .from("knowledge_conflicts")
      .insert(conflictToRow(conflict))
      .select("*")
      .single();

    if (error) {
      // The partial unique index allows one open conflict per pair. Hitting it
      // means this disagreement is already on record, which is not a failure.
      if (error.code === "23505") {
        return null;
      }

      throw new Error(`Failed to record knowledge conflict: ${error.message}`);
    }

    return conflictFromRow(data as ConflictRow);
  }

  async findConflictById(
    organizationId: OrganizationId,
    id: KnowledgeConflictId,
  ): Promise<KnowledgeConflict | null> {
    const { data, error } = await this.client
      .from("knowledge_conflicts")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to read knowledge conflict: ${error.message}`);
    return data ? conflictFromRow(data as ConflictRow) : null;
  }

  async findConflicts(
    organizationId: OrganizationId,
    query: KnowledgeConflictQuery = {},
  ): Promise<KnowledgeConflict[]> {
    let builder = this.client
      .from("knowledge_conflicts")
      .select("*")
      .eq("organization_id", organizationId)
      .order("detected_at", { ascending: false })
      .limit(Math.min(query.limit ?? 50, MAX_LIMIT));

    if (query.status) builder = builder.eq("status", query.status);

    // Only ever a validated uuid reaches this point, so it is safe inside
    // the or() filter string.
    if (query.memoryId) {
      builder = builder.or(
        `memory_id.eq.${query.memoryId},conflicting_memory_id.eq.${query.memoryId}`,
      );
    }

    const { data, error } = await builder;

    if (error) throw new Error(`Failed to read knowledge conflicts: ${error.message}`);
    return ((data ?? []) as ConflictRow[]).map(conflictFromRow);
  }

  async updateConflict(
    conflict: KnowledgeConflict,
  ): Promise<KnowledgeConflict> {
    const { data, error } = await this.client
      .from("knowledge_conflicts")
      .update(conflictToRow(conflict))
      .eq("id", conflict.id)
      .eq("organization_id", conflict.organizationId)
      .select("*")
      .single();

    if (error) throw new Error(`Failed to update knowledge conflict: ${error.message}`);
    return conflictFromRow(data as ConflictRow);
  }
}

function recallToRow(recall: KnowledgeRecall) {
  return {
    id: recall.id,
    organization_id: recall.organizationId,
    memory_id: recall.memoryId,
    work_id: recall.workId ?? null,
    task_id: recall.taskId ?? null,
    agent_id: recall.agentId ?? null,
    stage: recall.stage,
    rank: recall.rank,
    score: recall.score,
    reasons: recall.reasons,
    recalled_at: recall.recalledAt.toISOString(),
  };
}

function recallFromRow(row: RecallRow): KnowledgeRecall {
  return {
    id: row.id as KnowledgeRecallId,
    organizationId: row.organization_id as OrganizationId,
    memoryId: row.memory_id as MemoryId,
    workId: row.work_id ? (row.work_id as WorkId) : undefined,
    taskId: row.task_id ? (row.task_id as TaskId) : undefined,
    agentId: row.agent_id ? (row.agent_id as AgentId) : undefined,
    stage: row.stage,
    rank: row.rank,
    score: row.score,
    reasons: Array.isArray(row.reasons)
      ? row.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    recalledAt: new Date(row.recalled_at),
  };
}

function conflictToRow(conflict: KnowledgeConflict) {
  return {
    id: conflict.id,
    organization_id: conflict.organizationId,
    memory_id: conflict.memoryId,
    conflicting_memory_id: conflict.conflictingMemoryId,
    reason: conflict.reason,
    signals: conflict.signals,
    status: conflict.status,
    resolution: conflict.resolution ?? null,
    resolved_by: conflict.resolvedBy ?? null,
    resolved_at: conflict.resolvedAt?.toISOString() ?? null,
    detected_at: conflict.detectedAt.toISOString(),
  };
}

function conflictFromRow(row: ConflictRow): KnowledgeConflict {
  return {
    id: row.id as KnowledgeConflictId,
    organizationId: row.organization_id as OrganizationId,
    memoryId: row.memory_id as MemoryId,
    conflictingMemoryId: row.conflicting_memory_id as MemoryId,
    reason: row.reason,
    signals: row.signals ?? {},
    status: row.status,
    resolution: row.resolution ?? undefined,
    resolvedBy: row.resolved_by ?? undefined,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    detectedAt: new Date(row.detected_at),
  };
}
