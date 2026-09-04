import type {
  AgentId,
  Artifact,
  ArtifactId,
  OrganizationId,
  TaskId,
  WorkId,
} from "@unioffice/core";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtifactRepository } from "./artifact-repository.js";

interface ArtifactRow {
  id: string;
  organization_id: string;
  work_id: string | null;
  task_id: string | null;
  created_by_agent_id: string | null;
  name: string;
  type: Artifact["type"];
  description: string | null;
  uri: string | null;
  mime_type: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

export class SupabaseArtifactRepository implements ArtifactRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(artifact: Artifact): Promise<Artifact> {
    const { data, error } = await this.client
      .from("artifacts")
      .insert(toRow(artifact))
      .select()
      .single();

    if (error) throw new Error(`Failed to create artifact: ${error.message}`);
    return fromRow(data as ArtifactRow);
  }

  async findById(id: ArtifactId): Promise<Artifact | null> {
    const { data, error } = await this.client
      .from("artifacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`Failed to find artifact: ${error.message}`);
    return data ? fromRow(data as ArtifactRow) : null;
  }

  async findByWork(workId: WorkId): Promise<Artifact[]> {
    const { data, error } = await this.client
      .from("artifacts")
      .select("*")
      .eq("work_id", workId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to find work artifacts: ${error.message}`);
    return (data as ArtifactRow[] ?? []).map(fromRow);
  }

  async findByTask(taskId: TaskId): Promise<Artifact[]> {
    const { data, error } = await this.client
      .from("artifacts")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(`Failed to find task artifacts: ${error.message}`);
    return (data as ArtifactRow[] ?? []).map(fromRow);
  }
}

function toRow(artifact: Artifact) {
  return {
    id: artifact.id,
    organization_id: artifact.organizationId,
    work_id: artifact.workId ?? null,
    task_id: artifact.taskId ?? null,
    created_by_agent_id: artifact.createdByAgentId ?? null,
    name: artifact.name,
    type: artifact.type,
    description: artifact.description ?? null,
    uri: artifact.uri ?? null,
    mime_type: artifact.mimeType ?? null,
    version: artifact.version,
    created_at: artifact.createdAt.toISOString(),
    updated_at: artifact.updatedAt.toISOString(),
    metadata: artifact.metadata,
  };
}

function fromRow(row: ArtifactRow): Artifact {
  return {
    id: row.id as ArtifactId,
    organizationId: row.organization_id as OrganizationId,
    workId: row.work_id ? (row.work_id as WorkId) : undefined,
    taskId: row.task_id ? (row.task_id as TaskId) : undefined,
    createdByAgentId: row.created_by_agent_id
      ? (row.created_by_agent_id as AgentId)
      : undefined,
    name: row.name,
    type: row.type,
    description: row.description ?? undefined,
    uri: row.uri ?? undefined,
    mimeType: row.mime_type ?? undefined,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata ?? {},
  };
}
