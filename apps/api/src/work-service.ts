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
  PlanningToolDescriptor,
  WorkPlan,
} from "@unioffice/orchestrator";

import type {
  EventRecorder,
} from "./event-recorder.js";

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

    private readonly eventRecorder: EventRecorder,

    /** The real, registered tools the planner may request by id. */
    private readonly availableTools: PlanningToolDescriptor[] = [],
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

    await this.eventRecorder.record({
      organizationId: updatedWork.organizationId,
      workId: updatedWork.id,
      type: "work.planning_started",
      payload: {
        objective: updatedWork.objective,
      },
    });

    try {
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

      if (availableAgents.length === 0) {
        throw new Error(
          "Cannot plan work without active agents.",
        );
      }

      const plan =
        await this.planner.plan({
          workId: updatedWork.id,

          objective:
            updatedWork.objective,

          availableAgentIds:
            availableAgents.map(
              (agent) => agent.id,
            ),

          availableTools: this.availableTools,

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

            approval: plannedTask.requiresApproval
              ? {
                  required: true,
                  reason: plannedTask.approvalReason,
                  status: "not_requested",
                }
              : undefined,

            routing: {
              requiredCapabilities:
                plannedTask.requiredCapabilities ?? [],
              requiredTools:
                plannedTask.requiredTools ?? [],
              suggestedAgentType:
                plannedTask.suggestedAgentType,
            },

            delegation:
              delegation.metadata,
          },
        };

        const createdTask =
          await this.taskRepository.create(
            task,
          );

        tasks.push(createdTask);

        await this.eventRecorder.record({
          organizationId: updatedWork.organizationId,
          workId: updatedWork.id,
          taskId: createdTask.id,
          agentId: createdTask.assignedAgentId,
          type: "task.created",
          payload: {
            title: createdTask.title,
            plannerRef: plannedTask.ref,
            dependsOn: createdTask.dependsOn,
            requiredCapabilities:
              plannedTask.requiredCapabilities ?? [],
            requiredTools:
              plannedTask.requiredTools ?? [],
            requiresApproval:
              plannedTask.requiresApproval ?? false,
          },
        });

        await this.eventRecorder.record({
          organizationId: updatedWork.organizationId,
          workId: updatedWork.id,
          taskId: createdTask.id,
          agentId: createdTask.assignedAgentId,
          type: "agent.assigned",
          payload: {
            agentId: createdTask.assignedAgentId,
            delegation: delegation.metadata,
          },
        });
      }

      const plannedWork =
        await this.workRepository.update({
          ...updatedWork,
          status: "queued",
          updatedAt: new Date(),
          metadata: {
            ...updatedWork.metadata,
            plan: {
              taskCount: tasks.length,
              createdAt: new Date().toISOString(),
            },
          },
        });

      await this.eventRecorder.record({
        organizationId: plannedWork.organizationId,
        workId: plannedWork.id,
        type: "work.planning_completed",
        payload: {
          taskCount: tasks.length,
        },
      });

      return {
        work: plannedWork,

        plan,

        tasks,
      };
    } catch (error) {
      const failedWork =
        await this.workRepository.update({
          ...updatedWork,
          status: "failed",
          updatedAt: new Date(),
          completedAt: new Date(),
          metadata: {
            ...updatedWork.metadata,
            planningError: errorMessage(error),
          },
        });

      await this.eventRecorder.record({
        organizationId: failedWork.organizationId,
        workId: failedWork.id,
        type: "work.failed",
        payload: {
          stage: "planning",
          error: errorMessage(error),
        },
      });

      throw error;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
