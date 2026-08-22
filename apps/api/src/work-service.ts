import type {
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  AgentRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  Delegator,
  Planner,
  WorkPlan,
} from "@unioffice/orchestrator";

export interface PlanWorkResult {
  work: Work;

  plan: WorkPlan;

  tasks: Task[];
}

export class WorkService {
  constructor(
    private readonly workRepository: WorkRepository,

    private readonly taskRepository: TaskRepository,

    private readonly agentRepository: AgentRepository,

    private readonly planner: Planner,

    private readonly delegator: Delegator,
  ) {}

  async planWork(
    workId: WorkId,
  ): Promise<PlanWorkResult> {
    const work =
      await this.workRepository.findById(
        workId,
      );

    if (!work) {
      throw new Error(
        `Work not found: ${workId}`,
      );
    }

    if (
      work.status !== "queued" &&
      work.status !== "planning"
    ) {
      throw new Error(
        `Work cannot be planned from status: ${work.status}`,
      );
    }

    const planningWork: Work = {
      ...work,
      status: "planning",
      updatedAt: new Date(),
    };

    const updatedWork =
      await this.workRepository.update(
        planningWork,
      );

    const agents =
      await this.agentRepository.findByOrganization(
        updatedWork.organizationId,
      );

    const availableAgents =
      agents.filter(
        (agent) =>
          agent.status === "active" &&
          (
            !updatedWork.workspaceId ||
            !agent.workspaceId ||
            agent.workspaceId ===
              updatedWork.workspaceId
          ),
      );

    const plan =
      await this.planner.plan({
        workId: updatedWork.id,

        objective:
          updatedWork.objective,

        availableAgentIds:
          availableAgents.map(
            (agent) => agent.id,
          ),

        context: {
          organizationId:
            updatedWork.organizationId,

          workspaceId:
            updatedWork.workspaceId,
        },
      });

    const tasks: Task[] = [];

    for (const plannedTask of plan.tasks) {
      const delegation =
        await this.delegator.delegate({
          workId: updatedWork.id,

          task: plannedTask,

          availableAgentIds:
            availableAgents.map(
              (agent) => agent.id,
            ),

          organizationId:
            updatedWork.organizationId,

          workspaceId:
            updatedWork.workspaceId,

          context: {
            objective:
              updatedWork.objective,
          },
        });

      const now = new Date();

      const task: Task = {
        id: plannedTask.id,

        workId: updatedWork.id,

        title:
          plannedTask.title,

        description:
          plannedTask.description,

        status: "pending",

        assignedAgentId:
          delegation.agentId,

        dependsOn:
          plannedTask.dependsOn,

        createdAt: now,

        updatedAt: now,

        metadata: {
          ...plannedTask.metadata,

          delegation:
            delegation.metadata,
        },
      };

      const createdTask =
        await this.taskRepository.create(
          task,
        );

      tasks.push(createdTask);
    }

    return {
      work: updatedWork,

      plan,

      tasks,
    };
  }
}