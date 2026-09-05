import type {
  AgentId,
  Memory,
  MemoryId,
  MemoryScope,
  MemoryType,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  MemoryQuery,
  MemoryRepository,
} from "./memory-repository.js";

interface MemoryRow {
  id: string;
  organization_id: string;
  agent_id: string | null;
  work_id: string | null;
  task_id: string | null;
  scope: MemoryScope;
  type: MemoryType;
  content: string;
  source: string | null;
  importance: number;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

const DEFAULT_QUERY_LIMIT = 50;

export class SupabaseMemoryRepository implements MemoryRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(memory: Memory): Promise<Memory> {
    const { data, error } = await this.client
      .from("memories")
      .insert(toRow(memory))
      .select()
      .single();

    if (error) throw new Error(`Failed to create memory: ${error.message}`);
    return fromRow(data as MemoryRow);
  }

  async findById(id: MemoryId): Promise<Memory | null> {
    const { data, error } = await this.client
      .from("memories")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find memory: ${error.message}`);
    return data ? fromRow(data as MemoryRow) : null;
  }

  async query(query: MemoryQuery): Promise<Memory[]> {
    let builder = this.client
      .from("memories")
      .select("*")
      .eq("organization_id", query.organizationId)
      .order("created_at", { ascending: false })
      .limit(query.limit ?? DEFAULT_QUERY_LIMIT);

    if (query.agentId) builder = builder.eq("agent_id", query.agentId);
    if (query.scope) builder = builder.eq("scope", query.scope);
    if (query.type) builder = builder.eq("type", query.type);

    const { data, error } = await builder;

    if (error) throw new Error(`Failed to query memories: ${error.message}`);
    return (data as MemoryRow[] ?? []).map(fromRow);
  }

  async update(memory: Memory): Promise<Memory> {
    const { data, error } = await this.client
      .from("memories")
      .update(toRow(memory))
      .eq("id", memory.id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update memory: ${error.message}`);
    return fromRow(data as MemoryRow);
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
    agent_id: memory.agentId ?? null,
    work_id: memory.workId ?? null,
    task_id: memory.taskId ?? null,
    scope: memory.scope,
    type: memory.type,
    content: memory.content,
    source: memory.source ?? null,
    importance: memory.importance,
    created_at: memory.createdAt.toISOString(),
    updated_at: memory.updatedAt.toISOString(),
    metadata: memory.metadata,
  };
}

function fromRow(row: MemoryRow): Memory {
  return {
    id: row.id as MemoryId,
    organizationId: row.organization_id as OrganizationId,
    agentId: row.agent_id ? (row.agent_id as AgentId) : undefined,
    workId: row.work_id ? (row.work_id as WorkId) : undefined,
    taskId: row.task_id ? (row.task_id as TaskId) : undefined,
    scope: row.scope,
    type: row.type,
    content: row.content,
    source: row.source ?? undefined,
    importance: row.importance,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata ?? {},
  };
}
