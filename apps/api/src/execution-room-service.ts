import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Artifact,
  Event,
  ExecutionJob,
  Memory,
  Task,
  TaskId,
  Work,
  WorkId,
  Workspace,
} from "@unioffice/core";

import type {
  AgentRepository,
  ApprovalRepository,
  ArtifactRepository,
  EventRepository,
  ExecutionJobRepository,
  MemoryRepository,
  TaskRepository,
  WorkRepository,
  WorkspaceRepository,
} from "@unioffice/database";

import type { ToolRegistry } from "@unioffice/tools";

import { buildExecutionPlan, type ExecutionPlan } from "./execution-plan.js";

/** A tool, as the room needs to name it. The schema belongs on /tools. */
export interface RoomTool {
  id: string;
  name: string;
  description: string;
}

/** What one agent is holding on this operation, and what it has produced. */
export interface RoomMember {
  agent: Agent;
  taskIds: TaskId[];
  /** The step they are on right now, if they are on one. */
  currentTaskId?: TaskId;
  /** The dependency that is holding them, named rather than referenced. */
  waitingOnTaskId?: TaskId;
  running: number;
  completed: number;
  failed: number;
  toolCalls: number;
  artifactCount: number;
  /** Why the delegator chose them, when it recorded a reason. */
  selectionReason?: string;
  /** True when the delegator settled for the closest available match. */
  stretched: boolean;
}

/**
 * One operation, whole.
 *
 * The mission surface used to assemble this out of four requests - the work
 * detail, the tool catalog, the roster and the workspace directory - because
 * the detail read deliberately returns only the agents a mission assigned,
 * which leaves out the orchestrator that planned it. Four round trips to
 * render one page, three of them fetching reference data that had not
 * changed, is the shape this replaces.
 */
export interface ExecutionRoom {
  work: Work;
  workspace?: Workspace;

  tasks: Task[];
  events: Event[];
  artifacts: Artifact[];
  approvals: ApprovalRequest[];
  memories: Memory[];

  /** The durable queue row behind this work, when one is active. */
  executionJob: ExecutionJob | null;

  /** Everyone the room might have to name: the cast, plus who planned it. */
  agents: Agent[];
  orchestrator?: Agent;

  /** Who is holding what, derived from the task rows. */
  cast: RoomMember[];

  /** The plan as a dependency graph rather than a list. */
  plan: ExecutionPlan;

  tools: RoomTool[];
}

export class ExecutionRoomService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly eventRepository: EventRepository,
    private readonly artifactRepository: ArtifactRepository,
    private readonly approvalRepository: ApprovalRepository,
    private readonly agentRepository: AgentRepository,
    private readonly memoryRepository: MemoryRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly executionJobRepository: ExecutionJobRepository,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  async getRoom(workId: WorkId): Promise<ExecutionRoom> {
    const work = await this.workRepository.findById(workId);

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    const [
      tasks,
      events,
      artifacts,
      approvals,
      roster,
      memories,
      executionJob,
      workspace,
    ] = await Promise.all([
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
      this.executionJobRepository.findActiveByWork(workId),
      work.workspaceId
        ? this.workspaceRepository.findById(work.workspaceId)
        : Promise.resolve(null),
    ]);

    const orchestrator = roster.find((agent) => agent.type === "orchestrator");

    const involved = new Set<AgentId>(
      tasks.flatMap((task) => (task.assignedAgentId ? [task.assignedAgentId] : [])),
    );

    // Events name agents the plan never assigned - the orchestrator, most
    // obviously - and a record that cannot put a name to its own lines is
    // worse than one extra row on the wire.
    for (const event of events) {
      if (event.agentId) involved.add(event.agentId);
    }

    if (orchestrator) involved.add(orchestrator.id);

    const agents = roster.filter((agent) => involved.has(agent.id));

    const pendingTaskIds = approvals
      .filter((approval) => approval.status === "pending")
      .map((approval) => approval.taskId);

    return {
      work,
      workspace:
        workspace && workspace.organizationId === work.organizationId
          ? workspace
          : undefined,
      tasks,
      events,
      artifacts,
      approvals,
      memories,
      executionJob,
      agents,
      orchestrator,
      cast: assembleCast(tasks, agents, artifacts),
      plan: buildExecutionPlan(tasks, {
        awaitingApprovalTaskIds: pendingTaskIds,
      }),
      tools: this.toolRegistry.list().map((tool) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
      })),
    };
  }
}

/**
 * Who is on this operation, read off the tasks.
 *
 * An agent appears because it was delegated work, never because it exists on
 * the roster - the roster is a different question, answered elsewhere.
 */
function assembleCast(
  tasks: Task[],
  agents: Agent[],
  artifacts: Artifact[],
): RoomMember[] {
  const byAgent = new Map<AgentId, Task[]>();

  for (const task of tasks) {
    if (!task.assignedAgentId) continue;

    const held = byAgent.get(task.assignedAgentId) ?? [];
    held.push(task);
    byAgent.set(task.assignedAgentId, held);
  }

  const completedIds = new Set(
    tasks.filter((task) => task.status === "completed").map((task) => task.id),
  );

  const members: RoomMember[] = [];

  for (const [agentId, held] of byAgent) {
    const agent = agents.find((candidate) => candidate.id === agentId);
    if (!agent) continue;

    const current = held.find((task) => task.status === "running");

    // What this agent is actually waiting for: the first unfinished
    // dependency of the first step of theirs that cannot start yet.
    const stalled = held.find(
      (task) =>
        (task.status === "pending" || task.status === "ready") &&
        task.dependsOn.some((id) => !completedIds.has(id)),
    );

    const delegation = held.find((task) => task.metadata.delegation)?.metadata
      .delegation as Record<string, unknown> | undefined;

    const selectionReason = delegation?.selectionReason;

    members.push({
      agent,
      taskIds: held.map((task) => task.id),
      currentTaskId: current?.id,
      waitingOnTaskId: stalled?.dependsOn.find((id) => !completedIds.has(id)),
      running: held.filter((task) => task.status === "running").length,
      completed: held.filter((task) => task.status === "completed").length,
      failed: held.filter((task) => task.status === "failed").length,
      toolCalls: held.reduce((total, task) => {
        const execution = task.metadata.execution as
          | { toolCalls?: unknown[] }
          | undefined;

        return (
          total +
          (Array.isArray(execution?.toolCalls) ? execution.toolCalls.length : 0)
        );
      }, 0),
      artifactCount: artifacts.filter(
        (artifact) => artifact.createdByAgentId === agentId,
      ).length,
      selectionReason:
        typeof selectionReason === "string" ? selectionReason : undefined,
      stretched: held.some(
        (task) =>
          (task.metadata.delegation as { capabilityFit?: string } | undefined)
            ?.capabilityFit === "partial",
      ),
    });
  }

  // Whoever is working comes first, then whoever holds the most of the plan.
  return members.sort((left, right) => {
    if (left.running !== right.running) return right.running - left.running;
    return right.taskIds.length - left.taskIds.length;
  });
}
