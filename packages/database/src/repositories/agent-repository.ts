import type {
  Agent,
  AgentId,
  OrganizationId,
} from "@unioffice/core";

export interface AgentRepository {
  create(agent: Agent): Promise<Agent>;

  findById(id: AgentId): Promise<Agent | null>;

  findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Agent[]>;

  update(agent: Agent): Promise<Agent>;

  delete(id: AgentId): Promise<void>;
}