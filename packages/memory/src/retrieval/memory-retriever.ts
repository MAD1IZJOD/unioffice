import type {
  AgentId,
  OrganizationId,
} from "@unioffice/core";

import type {
  Memory,
} from "../memory.js";

export interface MemoryRetrievalContext {
  organizationId: OrganizationId;

  agentId?: AgentId;

  query: string;

  limit?: number;
}

export interface MemoryRetriever {
  retrieve(
    context: MemoryRetrievalContext,
  ): Promise<Memory[]>;
}