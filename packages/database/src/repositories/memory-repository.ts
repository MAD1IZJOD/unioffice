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

export interface MemoryQuery {
  organizationId: OrganizationId;

  agentId?: AgentId;

  /** Narrows to what one work item contributed to the company's memory. */
  workId?: WorkId;

  taskId?: TaskId;

  /** Narrows to knowledge derived from one artifact. */
  artifactId?: ArtifactId;

  scope?: MemoryScope;

  type?: MemoryType;

  types?: MemoryType[];

  statuses?: KnowledgeStatus[];

  /**
   * A workspace id narrows to that workspace's knowledge. null narrows to
   * company-wide knowledge only. Absent does not narrow.
   */
  workspaceId?: WorkspaceId | null;

  sourceType?: KnowledgeSourceType;

  minImportance?: number;

  createdAfter?: Date;

  createdBefore?: Date;

  contentHash?: string;

  limit?: number;

  offset?: number;
}

export interface MemoryRepository {
  create(memory: Memory): Promise<Memory>;

  findById(id: MemoryId): Promise<Memory | null>;

  /** Most recently created memories matching the filters, newest first. */
  query(query: MemoryQuery): Promise<Memory[]>;

  update(memory: Memory): Promise<Memory>;

  delete(id: MemoryId): Promise<void>;
}
