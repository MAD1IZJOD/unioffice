import type {
  AgentId,
  ArtifactId,
  KnowledgeSourceType,
  KnowledgeStatus,
  Memory,
  MemoryId,
  MemoryScope,
  MemoryType,
  OrganizationId,
  TaskId,
  WorkId,
  WorkspaceId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  KnowledgeCandidateQuery,
  KnowledgeCandidateRow,
  KnowledgeSearchRepository,
} from "./knowledge-repository.js";

import type {
  MemoryQuery,
  MemoryRepository,
} from "./memory-repository.js";

interface MemoryRow {
  id: string;
  organization_id: string;
  workspace_id: string | null;
  agent_id: string | null;
  work_id: string | null;
  task_id: string | null;
  artifact_id: string | null;
  scope: MemoryScope;
  type: MemoryType;
  status: KnowledgeStatus;
  title: string;
  content: string;
  source: string | null;
  source_type: KnowledgeSourceType;
  importance: number;
  confidence: number | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  supersedes_id: string | null;
  archived_at: string | null;
  content_hash: string | null;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

interface CandidateRow {
  memory_id: string;
  semantic_similarity: number | null;
  keyword_rank: number | null;
}

/**
 * Every column except the embedding and the search vector. A 768-number
 * vector per row is several kilobytes of JSON nobody outside retrieval reads,
 * and `select *` would ship it on every list.
 */
const MEMORY_COLUMNS = [
  "id",
  "organization_id",
  "workspace_id",
  "agent_id",
  "work_id",
  "task_id",
  "artifact_id",
  "scope",
  "type",
  "status",
  "title",
  "content",
  "source",
  "source_type",
  "importance",
  "confidence",
  "created_by",
  "reviewed_by",
  "reviewed_at",
  "supersedes_id",
  "archived_at",
  "content_hash",
  "embedding_model",
  "created_at",
  "updated_at",
  "metadata",
].join(", ");

const DEFAULT_QUERY_LIMIT = 50;

/** The most any single read will return, whatever a caller asks for. */
const MAX_QUERY_LIMIT = 200;

const KNOWLEDGE_STATUSES: KnowledgeStatus[] = ["proposed", "active", "archived"];

export class SupabaseMemoryRepository
  implements MemoryRepository, KnowledgeSearchRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async create(memory: Memory): Promise<Memory> {
    const { data, error } = await this.client
      .from("memories")
      .insert(toRow(memory))
      .select(MEMORY_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to create memory: ${error.message}`);
    return fromRow(data as unknown as MemoryRow);
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    const { data, error } = await this.client
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find memory: ${error.message}`);
    return data ? fromRow(data as unknown as MemoryRow) : null;
  }

  async query(query: MemoryQuery): Promise<Memory[]> {
    const limit = Math.min(query.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);

    let builder = this.client
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("organization_id", query.organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (query.agentId) builder = builder.eq("agent_id", query.agentId);
    if (query.workId) builder = builder.eq("work_id", query.workId);
    if (query.taskId) builder = builder.eq("task_id", query.taskId);
    if (query.artifactId) builder = builder.eq("artifact_id", query.artifactId);
    if (query.scope) builder = builder.eq("scope", query.scope);
    if (query.type) builder = builder.eq("type", query.type);
    if (query.types?.length) builder = builder.in("type", query.types);
    if (query.statuses?.length) builder = builder.in("status", query.statuses);
    if (query.workspaceId === null) builder = builder.is("workspace_id", null);
    if (query.workspaceId) builder = builder.eq("workspace_id", query.workspaceId);
    if (query.sourceType) builder = builder.eq("source_type", query.sourceType);
    if (query.minImportance !== undefined) builder = builder.gte("importance", query.minImportance);
    if (query.createdAfter) builder = builder.gte("created_at", query.createdAfter.toISOString());
    if (query.createdBefore) builder = builder.lte("created_at", query.createdBefore.toISOString());
    if (query.contentHash) builder = builder.eq("content_hash", query.contentHash);

    const { data, error } = await builder;

    if (error) throw new Error(`Failed to query memories: ${error.message}`);
    return ((data ?? []) as unknown as MemoryRow[]).map(fromRow);
  }

  async update(memory: Memory): Promise<Memory> {
    const { data, error } = await this.client
      .from("memories")
      .update(toRow(memory))
      .eq("id", memory.id)
      // The row's organization is re-asserted on every write, so an update
      // built from a stale or forged object cannot move across tenants.
      .eq("organization_id", memory.organizationId)
      .select(MEMORY_COLUMNS)
      .single();

    if (error) throw new Error(`Failed to update memory: ${error.message}`);
    return fromRow(data as unknown as MemoryRow);
  }

  async delete(id: MemoryId): Promise<void> {
    const { error } = await this.client
      .from("memories")
      .delete()
      .eq("id", id);

    if (error) throw new Error(`Failed to delete memory: ${error.message}`);
  }

  async searchCandidates(
    query: KnowledgeCandidateQuery,
  ): Promise<KnowledgeCandidateRow[]> {
    const { data, error } = await this.client.rpc("match_knowledge", {
      p_organization_id: query.organizationId,
      p_statuses: query.statuses,
      p_workspace_mode: query.workspace.mode,
      p_workspace_id:
        query.workspace.mode === "company_and_workspace"
          ? query.workspace.workspaceId
          : null,
      p_query_embedding: query.embedding ? vectorLiteral(query.embedding) : null,
      p_query_terms: query.terms,
      p_candidate_limit: query.candidateLimit,
    });

    if (error) throw new Error(`Failed to search knowledge: ${error.message}`);

    return ((data ?? []) as CandidateRow[]).map((row) => ({
      memoryId: row.memory_id as MemoryId,
      semanticSimilarity: row.semantic_similarity ?? undefined,
      keywordRank: row.keyword_rank ?? 0,
    }));
  }

  async findByIds(
    organizationId: OrganizationId,
    ids: MemoryId[],
  ): Promise<Memory[]> {
    if (ids.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", ids.slice(0, MAX_QUERY_LIMIT));

    if (error) throw new Error(`Failed to read knowledge: ${error.message}`);
    return ((data ?? []) as unknown as MemoryRow[]).map(fromRow);
  }

  async setEmbedding(
    organizationId: OrganizationId,
    id: MemoryId,
    embedding: number[],
    model: string,
  ): Promise<void> {
    const { error } = await this.client
      .from("memories")
      .update({
        embedding: vectorLiteral(embedding),
        embedding_model: model,
        embedded_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", organizationId);

    if (error) throw new Error(`Failed to store embedding: ${error.message}`);
  }

  async findMissingEmbeddings(
    organizationId: OrganizationId,
    limit: number,
  ): Promise<Memory[]> {
    const { data, error } = await this.client
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("organization_id", organizationId)
      .is("embedding", null)
      .neq("status", "archived")
      .order("created_at", { ascending: true })
      .limit(Math.min(limit, MAX_QUERY_LIMIT));

    if (error) throw new Error(`Failed to find unembedded knowledge: ${error.message}`);
    return ((data ?? []) as unknown as MemoryRow[]).map(fromRow);
  }

  async countByStatus(
    organizationId: OrganizationId,
  ): Promise<Record<KnowledgeStatus, number>> {
    const counts = await Promise.all(
      KNOWLEDGE_STATUSES.map(async (status) => {
        const { count, error } = await this.client
          .from("memories")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", status);

        if (error) throw new Error(`Failed to count knowledge: ${error.message}`);
        return [status, count ?? 0] as const;
      }),
    );

    return Object.fromEntries(counts) as Record<KnowledgeStatus, number>;
  }
}

/** pgvector's text form. Every value is validated finite before it gets here. */
function vectorLiteral(values: number[]): string {
  if (!values.every((value) => Number.isFinite(value))) {
    throw new Error("An embedding must contain only finite numbers.");
  }

  return `[${values.join(",")}]`;
}

function toRow(memory: Memory) {
  return {
    id: memory.id,
    organization_id: memory.organizationId,
    workspace_id: memory.workspaceId ?? null,
    agent_id: memory.agentId ?? null,
    work_id: memory.workId ?? null,
    task_id: memory.taskId ?? null,
    artifact_id: memory.artifactId ?? null,
    scope: memory.scope,
    type: memory.type,
    status: memory.status,
    title: memory.title,
    content: memory.content,
    source: memory.source ?? null,
    source_type: memory.sourceType,
    importance: memory.importance,
    confidence: memory.confidence ?? null,
    created_by: memory.createdBy ?? null,
    reviewed_by: memory.reviewedBy ?? null,
    reviewed_at: memory.reviewedAt?.toISOString() ?? null,
    supersedes_id: memory.supersedesId ?? null,
    archived_at: memory.archivedAt?.toISOString() ?? null,
    content_hash: memory.contentHash ?? null,
    created_at: memory.createdAt.toISOString(),
    updated_at: memory.updatedAt.toISOString(),
    metadata: memory.metadata,
  };
}

function fromRow(row: MemoryRow): Memory {
  return {
    id: row.id as MemoryId,
    organizationId: row.organization_id as OrganizationId,
    workspaceId: row.workspace_id ? (row.workspace_id as WorkspaceId) : undefined,
    agentId: row.agent_id ? (row.agent_id as AgentId) : undefined,
    workId: row.work_id ? (row.work_id as WorkId) : undefined,
    taskId: row.task_id ? (row.task_id as TaskId) : undefined,
    artifactId: row.artifact_id ? (row.artifact_id as ArtifactId) : undefined,
    scope: row.scope,
    type: row.type,
    status: row.status,
    title: row.title,
    content: row.content,
    source: row.source ?? undefined,
    sourceType: row.source_type,
    importance: row.importance,
    confidence: row.confidence ?? undefined,
    createdBy: row.created_by ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
    supersedesId: row.supersedes_id ? (row.supersedes_id as MemoryId) : undefined,
    archivedAt: row.archived_at ? new Date(row.archived_at) : undefined,
    contentHash: row.content_hash ?? undefined,
    embeddingModel: row.embedding_model ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata ?? {},
  };
}
