import type {
  AgentId,
  OrganizationId,
} from "@unioffice/core";

import type {
  Memory,
  MemoryScope,
  MemoryType,
} from "../memory.js";

export interface MemoryQuery {
  organizationId: OrganizationId;

  agentId?: AgentId;

  scope?: MemoryScope;

  type?: MemoryType;

  limit?: number;
}

export interface MemoryStore {
  create(memory: Memory): Promise<Memory>;

  getById(id: string): Promise<Memory | null>;

  query(query: MemoryQuery): Promise<Memory[]>;

  update(memory: Memory): Promise<Memory>;

  delete(id: string): Promise<void>;
}