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

export class SupabaseMemoryRepository implements MemoryRepository {
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
    let builder = this.client
      .from("memories")
      .select(MEMORY_COLUMNS)
      .eq("organization_id", query.organizationId)
      .order("created_at", { ascending: false })
      .limit(query.limit ?? DEFAULT_QUERY_LIMIT);

    if (query.agentId) builder = builder.eq("agent_id", query.agentId);
    if (query.workId) builder = builder.eq("work_id", query.workId);
    if (query.scope) builder = builder.eq("scope", query.scope);
    if (query.type) builder = builder.eq("type", query.type);

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
