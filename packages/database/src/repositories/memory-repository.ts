import type {
  AgentId,
  Memory,
  MemoryId,
  MemoryScope,
  MemoryType,
  OrganizationId,
  WorkId,
} from "@unioffice/core";

export interface MemoryQuery {
  organizationId: OrganizationId;

  agentId?: AgentId;

  /** Narrows to what one work item contributed to the company's memory. */
  workId?: WorkId;

  scope?: MemoryScope;

  type?: MemoryType;

  limit?: number;
}

export interface MemoryRepository {
  create(memory: Memory): Promise<Memory>;

  findById(id: MemoryId): Promise<Memory | null>;

  /** Most recently created memories matching the filters, newest first. */
  query(query: MemoryQuery): Promise<Memory[]>;

  update(memory: Memory): Promise<Memory>;

  delete(id: MemoryId): Promise<void>;
}
