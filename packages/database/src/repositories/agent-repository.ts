import type {
  Agent,
  AgentId,
  OrganizationId,
  WorkspaceId,
} from "@unioffice/core";

export interface AgentRepository {
  create(agent: Agent): Promise<Agent>;

  findById(id: AgentId): Promise<Agent | null>;

  findByOrganization(
    organizationId: OrganizationId,
  ): Promise<Agent[]>;

  /**
   * The agents assigned to one workspace. Scoped in the query rather than by
   * filtering an organization-wide read, so the boundary is enforced where
   * the data lives and stays enforceable once there is an authorization layer
   * to enforce it for.
   */
  findByWorkspace(
    organizationId: OrganizationId,
    workspaceId: WorkspaceId,
  ): Promise<Agent[]>;

  update(agent: Agent): Promise<Agent>;

  delete(id: AgentId): Promise<void>;
}