import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Event,
  Artifact,
  OrganizationId,
  Task,
  Work,
  WorkId,
  WorkStatus,
} from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  EventRepository,
  ArtifactRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

export interface ListWorkOptions {
  status?: WorkStatus;
  limit?: number;
}

/**
 * Everything a work detail view needs in one round trip. The individual
 * collections stay available on their own routes; this exists so the UI
 * isn't making five sequential requests to render one page.
 */
export interface WorkDetail {
  work: Work;
  tasks: Task[];
  events: Event[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  agents: Agent[];
}

export class WorkQueryService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRepository: EventRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly agentRepository: AgentRepository,
    private readonly approvalRepository: ApprovalRepository,
  ) {}

  async getWork(workId: WorkId): Promise<Work> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    return work;
  }

  async getTasks(workId: WorkId): Promise<Task[]> {
    await this.getWork(workId);

    return this.taskRepository.findByWork(workId);
  }

  async getEvents(workId: WorkId): Promise<Event[]> {
    await this.getWork(workId);

    return this.eventRepository.findByWork(workId);
  }

  async getArtifacts(workId: WorkId): Promise<Artifact[]> {
    await this.getWork(workId);

    return this.artifactRepository.findByWork(workId);
  }

  /** The most recent events across the organization, newest first. */
  async getOrganizationActivity(
    organizationId: OrganizationId,
    limit?: number,
  ): Promise<Event[]> {
    return this.eventRepository.findByOrganization(organizationId, limit);
  }

  async getAgents(organizationId: OrganizationId): Promise<Agent[]> {
    return this.agentRepository.findByOrganization(organizationId);
  }

  /** Organization work, newest first, optionally narrowed to one status. */
  async listWork(
    organizationId: OrganizationId,
    options: ListWorkOptions = {},
  ): Promise<Work[]> {
    const work = await this.workRepository.findByOrganization(organizationId);
    const filtered = options.status
      ? work.filter((item) => item.status === options.status)
      : work;

    return filtered
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, options.limit ?? 50);
  }

  async getWorkDetail(workId: WorkId): Promise<WorkDetail> {
    const work = await this.getWork(workId);

    const [tasks, events, artifacts, approvals, agents] = await Promise.all([
      this.taskRepository.findByWork(workId),
      this.eventRepository.findByWork(workId),
      this.artifactRepository.findByWork(workId),
      this.approvalRepository.findByWork(workId),
      this.agentRepository.findByOrganization(work.organizationId),
    ]);

    // Only the agents this work actually involves - the page renders their
    // names and roles inline, and shipping the whole roster to render two
    // names is wasteful once an organization has a real workforce.
    const involvedAgentIds = new Set<AgentId>(
      tasks.flatMap((task) => (task.assignedAgentId ? [task.assignedAgentId] : [])),
    );

    return {
      work,
      tasks,
      events,
      artifacts,
      approvals,
      agents: agents.filter((agent) => involvedAgentIds.has(agent.id)),
    };
  }

  async getOrganizationArtifacts(
    organizationId: OrganizationId,
    limit?: number,
  ): Promise<Artifact[]> {
    return this.artifactRepository.findByOrganization(organizationId, limit);
  }
}
