import type {
  AgentId,
  Memory,
  OrganizationId,
} from "@unioffice/core";

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
