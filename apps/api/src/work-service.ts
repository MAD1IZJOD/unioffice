import type {
  Skill,
  Task,
  Work,
  WorkId,
  WorkspaceId,
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

import type {
  KnowledgeRecallService,
  RecallResult,
} from "./knowledge-recall-service.js";

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

    /**
     * What the company already knows, recalled before the plan is written.
     * Absent, planning works exactly as it did before knowledge existed.
     */
    private readonly knowledgeRecall?: Pick<KnowledgeRecallService, "recallForPlanning">,

    /**
     * The skills that apply to a mission. Absent, planning works exactly as
     * it did before skills existed.
     */
    private readonly skills?: { effective(organizationId: Work["organizationId"], workspaceId?: WorkspaceId): Promise<Map<string, Skill>> },
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

      const availableCapabilities = [...new Set(
        availableAgents.flatMap((agent) => agent.capabilities),
      )];

      // Only skills some available agent actually holds are offered, so the
      // planner cannot pick one that nobody could be given.
      const effectiveSkills = this.skills
        ? await this.skills.effective(updatedWork.organizationId, updatedWork.workspaceId)
        : new Map<string, Skill>();
      const heldSlugs = new Set(availableAgents.flatMap((agent) => agent.skills ?? []));
      const offeredSkills = [...effectiveSkills.values()].filter((skill) => heldSlugs.has(skill.slug));

      // Objective, then recall, then plan. The orchestrator is the actor the
      // recall is governed and recorded for - it is the one reading it.
      const recalled = await this.recallForPlanning(
        updatedWork,
        agents.find(
          (agent) => agent.type === "orchestrator" && agent.status === "active",
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

          availableTools: this.availableTools,

          availableCapabilities,

          availableSkills: offeredSkills.map((skill) => ({
            slug: skill.slug,
            name: skill.name,
            description: skill.description,
            requiredTools: skill.requiredTools,
            requiredCapabilities: skill.requiredCapabilities,
          })),

          briefing: briefingOf(updatedWork),

          knowledge: recalled?.items,

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

        // The skill as it was when the step was routed: which version, from
        // which scope, and whether it needs a person. Recorded here, from the
        // server's own resolution, so governance reads it from the step
        // rather than from anything the planner wrote.
        const appliedSlug = typeof delegation.metadata.skill === "string" ? delegation.metadata.skill : undefined;
        const applied = appliedSlug ? effectiveSkills.get(appliedSlug) : undefined;

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
              skill: applied
                ? {
                    slug: applied.slug,
                    name: applied.name,
                    version: applied.version,
                    scope: applied.scope,
                    approval: applied.approval,
                    memory: applied.memory,
                  }
                : undefined,
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
              knowledge: recalled && recalled.items.length > 0
                ? {
                    recalled: recalled.items.map((item) => ({
                      ref: item.ref,
                      id: item.id,
                      title: item.title,
                      status: item.status,
                    })),
                    withheldByPolicy: recalled.withheldCount,
                  }
                : undefined,
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

  /**
   * Recall for the planner, best-effort. A knowledge failure is never allowed
   * to become a planning failure: the plan proceeds from the objective alone.
   */
  private async recallForPlanning(
    work: Work,
    orchestrator: Parameters<KnowledgeRecallService["recallForPlanning"]>[1],
  ): Promise<RecallResult | undefined> {
    if (!this.knowledgeRecall) {
      return undefined;
    }

    try {
      return await this.knowledgeRecall.recallForPlanning(work, orchestrator);
    } catch {
      return undefined;
    }
  }
}

/**
 * The requester's own briefing, when they attached one.
 *
 * It is stored on the work row at creation and read back here so the planner
 * sees the constraints the person actually typed. Anything that is not a
 * non-empty string is treated as absent - a briefing is never fabricated to
 * give the planner something to read.
 */
function briefingOf(work: Work): string | undefined {
  const briefing = work.metadata.briefing;

  return typeof briefing === "string" && briefing.trim()
    ? briefing.trim()
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
