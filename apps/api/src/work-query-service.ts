import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Event,
  Artifact,
  Memory,
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
  MemoryRepository,
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
  /** What this run left behind in the company's memory. Often empty. */
  memories: Memory[];
}

export class WorkQueryService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRepository: EventRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly agentRepository: AgentRepository,
    private readonly approvalRepository: ApprovalRepository,
    private readonly memoryRepository: MemoryRepository,
  ) {}

  async getWork(workId: WorkId): Promise<Work> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    return work;
  }

  /**
   * Confirms a work item belongs to the caller's organization before any
   * route touches it.
   *
   * The per-work routes take a bare UUID, so without this a caller could read
   * or drive any organization's work by guessing or leaking an id. A
   * mismatch is reported as "not found", identical to a genuinely missing
   * row, so the endpoint never confirms that some other organization's work
   * exists. Every /work/:id handler runs this first.
   */
  async assertWorkInOrganization(
    workId: WorkId,
    organizationId: OrganizationId,
  ): Promise<Work> {
    const work = await this.workRepository.findById(workId);

    if (!work || work.organizationId !== organizationId) {
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

    const [tasks, events, artifacts, approvals, agents, memories] =
      await Promise.all([
        this.taskRepository.findByWork(workId),
        this.eventRepository.findByWork(workId),
        this.artifactRepository.findByWork(workId),
        this.approvalRepository.findByWork(workId),
        this.agentRepository.findByOrganization(work.organizationId),
        this.memoryRepository.query({
          organizationId: work.organizationId,
          workId,
          limit: 50,
        }),
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
      memories,
    };
  }

  async getOrganizationArtifacts(
    organizationId: OrganizationId,
    limit?: number,
  ): Promise<Artifact[]> {
    return this.artifactRepository.findByOrganization(organizationId, limit);
  }
}
