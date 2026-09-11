import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Artifact,
  Event,
  OrganizationId,
  Task,
  Work,
  WorkId,
  WorkStatus,
} from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  ArtifactRepository,
  EventRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type { ToolRegistry } from "@unioffice/tools";

/** What a single agent is doing right now, derived from live task rows. */
export interface AgentPresence {
  agentId: AgentId;
  name: string;
  type: Agent["type"];
  status: Agent["status"];
  description: string;
  capabilities: string[];
  toolIds: string[];
  /** working | waiting | blocked | available | disabled */
  presence: "working" | "waiting" | "blocked" | "available" | "disabled";
  activeTask?: {
    id: Task["id"];
    workId: WorkId;
    title: string;
    status: Task["status"];
    startedAt?: Date;
  };
  completedTaskCount: number;
  failedTaskCount: number;
  lastActiveAt?: Date;
}

/**
 * How far through its plan one work item is.
 *
 * The Command Center showed a status pill and nothing else, so an objective
 * one step from finishing and one that had just started both read as
 * "executing". The task rows are already fetched here to derive agent
 * presence, so counting them per work item costs nothing extra.
 */
export interface WorkPace {
  workId: WorkId;
  total: number;
  completed: number;
  running: number;
  failed: number;
  /** Completed as a percentage of the plan. */
  progress: number;
}

export interface CompanyOverview {
  organizationId: OrganizationId;
  generatedAt: Date;
  work: {
    total: number;
    byStatus: Record<WorkStatus, number>;
    active: Work[];
    recentlyCompleted: Work[];
    /** Keyed by work id, for the items in `active` and `recentlyCompleted`. */
    pace: Record<string, WorkPace>;
  };
  tasks: {
    total: number;
    running: number;
    waiting: number;
    completed: number;
    failed: number;
  };
  agents: AgentPresence[];
  approvals: ApprovalRequest[];
  artifacts: Artifact[];
  activity: Event[];
  tools: Array<{
    id: string;
    name: string;
    description: string;
    authorizedAgentCount: number;
    callCount: number;
  }>;
}

const EMPTY_STATUS_COUNTS: Record<WorkStatus, number> = {
  queued: 0,
  planning: 0,
  executing: 0,
  waiting_approval: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
};

const ACTIVE_WORK_STATUSES: WorkStatus[] = [
  "planning",
  "executing",
  "waiting_approval",
  "queued",
];

/**
 * Assembles the single read the Command Center renders from. Everything here
 * is derived from persisted rows - there is deliberately no synthesized or
 * placeholder activity, so an empty company genuinely reads as empty.
 */
export class CompanyOverviewService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly agentRepository: AgentRepository,
    private readonly approvalRepository: ApprovalRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly eventRepository: EventRepository,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async getOverview(
    organizationId: OrganizationId,
    options: { activityLimit?: number } = {},
  ): Promise<CompanyOverview> {
    const [allWork, agents, approvals, artifacts, activity] = await Promise.all([
      this.workRepository.findByOrganization(organizationId),
      this.agentRepository.findByOrganization(organizationId),
      this.approvalRepository.findPendingByOrganization(organizationId),
      this.artifactRepository.findByOrganization(organizationId, 12),
      this.eventRepository.findByOrganization(
        organizationId,
        options.activityLimit ?? 40,
      ),
    ]);

    const byCreatedDescending = (left: Work, right: Work) =>
      right.createdAt.getTime() - left.createdAt.getTime();

    const active = allWork
      .filter((work) => ACTIVE_WORK_STATUSES.includes(work.status))
      .sort(byCreatedDescending)
      .slice(0, 8);

    const recentlyCompleted = allWork
      .filter((work) => work.status === "completed" || work.status === "failed")
      .sort((left, right) =>
        (right.completedAt ?? right.updatedAt).getTime() -
        (left.completedAt ?? left.updatedAt).getTime(),
      )
      .slice(0, 6);

    const byStatus = { ...EMPTY_STATUS_COUNTS };
    for (const work of allWork) {
      byStatus[work.status] += 1;
    }

    // Task rows are only reachable per-work, so presence is derived from the
    // work items that can currently have live tasks plus whatever the recent
    // completions contributed. Fetching every task for every historical work
    // would not scale and would not change the answer.
    const tasksOfInterest = await this.tasksForWork([
      ...active,
      ...recentlyCompleted,
    ]);

    return {
      organizationId,
      generatedAt: new Date(),
      work: {
        total: allWork.length,
        byStatus,
        active,
        recentlyCompleted,
        pace: paceOf([...active, ...recentlyCompleted], tasksOfInterest),
      },
      tasks: {
        total: tasksOfInterest.length,
        running: countStatus(tasksOfInterest, "running"),
        waiting: countStatus(tasksOfInterest, "waiting"),
        completed: countStatus(tasksOfInterest, "completed"),
        failed: countStatus(tasksOfInterest, "failed"),
      },
      agents: agents.map((agent) =>
        this.presenceFor(agent, tasksOfInterest, activity),
      ),
      approvals,
      artifacts,
      activity,
      tools: this.toolUsage(agents, activity),
    };
  }

  private async tasksForWork(work: Work[]): Promise<Task[]> {
    // One query, not one per mission. This used to fan out into a round trip
    // per work item, which on a company with a couple of weeks of history
    // made this read take the better part of a minute - and the live channel
    // made that worse rather than better, because it asks for it again
    // whenever anything happens.
    return this.taskRepository.findByWorkIds(work.map((item) => item.id));
  }

  private presenceFor(
    agent: Agent,
    tasks: Task[],
    activity: Event[],
  ): AgentPresence {
    const agentTasks = tasks.filter((task) => task.assignedAgentId === agent.id);
    const running = agentTasks.find((task) => task.status === "running");
    const waiting = agentTasks.find((task) => task.status === "waiting");
    const ready = agentTasks.find((task) => task.status === "ready");
    const failed = agentTasks.filter((task) => task.status === "failed");
    const activeTask = running ?? ready ?? waiting;

    const lastEvent = activity.find((event) => event.agentId === agent.id);

    return {
      agentId: agent.id,
      name: agent.name,
      type: agent.type,
      status: agent.status,
      description: agent.description,
      capabilities: agent.capabilities,
      toolIds: agent.toolIds,
      presence: resolvePresence(agent, {
        running: Boolean(running ?? ready),
        waiting: Boolean(waiting),
        blocked: failed.length > 0 && !running && !ready && !waiting,
      }),
      activeTask: activeTask
        ? {
            id: activeTask.id,
            workId: activeTask.workId,
            title: activeTask.title,
            status: activeTask.status,
            startedAt: activeTask.startedAt,
          }
        : undefined,
      completedTaskCount: countStatus(agentTasks, "completed"),
      failedTaskCount: failed.length,
      lastActiveAt: lastEvent?.timestamp,
    };
  }

  private toolUsage(
    agents: Agent[],
    activity: Event[],
  ): CompanyOverview["tools"] {
    return this.toolRegistry.list().map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      authorizedAgentCount: agents.filter((agent) =>
        agent.toolIds.includes(tool.id),
      ).length,
      callCount: activity.filter(
        (event) =>
          (event.type === "tool.completed" || event.type === "tool.failed") &&
          event.payload.toolId === tool.id,
      ).length,
    }));
  }
}

function paceOf(work: Work[], tasks: Task[]): Record<string, WorkPace> {
  const pace: Record<string, WorkPace> = {};

  for (const item of work) {
    if (pace[item.id]) continue;

    const owned = tasks.filter((task) => task.workId === item.id);
    const completed = countStatus(owned, "completed");

    pace[item.id] = {
      workId: item.id,
      total: owned.length,
      completed,
      running: countStatus(owned, "running"),
      failed: countStatus(owned, "failed"),
      progress:
        owned.length === 0 ? 0 : Math.round((completed / owned.length) * 100),
    };
  }

  return pace;
}

function resolvePresence(
  agent: Agent,
  signals: { running: boolean; waiting: boolean; blocked: boolean },
): AgentPresence["presence"] {
  if (agent.status !== "active") return "disabled";
  if (signals.running) return "working";
  if (signals.waiting) return "waiting";
  if (signals.blocked) return "blocked";
  return "available";
}

function countStatus(tasks: Task[], status: Task["status"]): number {
  return tasks.filter((task) => task.status === status).length;
}
