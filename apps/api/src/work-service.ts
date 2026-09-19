import {
  skillRefOf,
  type OrganizationId,
  type Skill,
  type Task,
  type Work,
  type WorkId,
  type WorkspaceId,
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

import { resolveSkill, type SkillMatch } from "@unioffice/skills";

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
    private readonly skills?: {
      effective(organizationId: Work["organizationId"], workspaceId?: WorkspaceId): Promise<Map<string, Skill>>;

      /**
       * Keeps the version a step is about to use, so the step can be run that
       * way however much the skill changes afterwards.
       */
      pin?(organizationId: OrganizationId, skill: Skill): Promise<Skill>;
    },
  ) {}

  /**
   * Marks a mission as being planned, if it is still waiting to be.
   *
   * Done as one conditional write, before anything answers the person who
   * asked, so there is no moment where a launched mission still reads as
   * waiting. Without that, a cancel landing in that moment was overwritten
   * by the plan and the cancelled mission went on to run. Cancelling a
   * mission that is actively being planned is already refused, so once this
   * returns true the two cannot race. False when it was not waiting.
   */
  async beginPlanning(workId: WorkId): Promise<boolean> {
    const now = new Date();

    if (this.workRepository.transitionStatus) {
      return (await this.workRepository.transitionStatus(workId, "queued", "planning", now)) !== null;
    }

    const work = await this.workRepository.findById(workId);
    if (!work || work.status !== "queued") return false;

    await this.workRepository.update({ ...work, status: "planning", updatedAt: now });
    return true;
  }

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
      // planner cannot suggest one that nobody could be given. Which skill a
      // step actually uses is settled below, here, from the skills as they
      // are - the planner's answer is one signal into that.
      const effectiveSkills = this.skills
        ? await this.skills.effective(updatedWork.organizationId, updatedWork.workspaceId)
        : new Map<string, Skill>();
      const candidateSkills = [...effectiveSkills.values()];
      const heldSlugs = new Set(availableAgents.flatMap((agent) => agent.skills ?? []));
      const offeredSkills = candidateSkills.filter((skill) => heldSlugs.has(skill.slug));

      // A skill someone named in the request itself. It still has to survive
      // the same checks as any other: naming a skill cannot conjure one.
      const requestedSkill = typeof updatedWork.metadata?.skill === "string"
        ? updatedWork.metadata.skill
        : undefined;
      const knownTools = new Set(this.availableTools.map((tool) => tool.id));

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
        // The server decides the skill, before anyone is given the step: the
        // step's own words and stated needs, against the skills that apply
        // here and the agents that could take it. What it decides is what the
        // step then requires, and what it is routed by.
        const resolution = resolveSkill({
          requirement: {
            text: `${plannedTask.title} ${plannedTask.description} ${updatedWork.objective}`,
            capabilities: plannedTask.requiredCapabilities ?? [],
            tools: plannedTask.requiredTools ?? [],
            requestedSlug: requestedSkill,
            suggestedSlug: plannedTask.skill,
          },
          skills: candidateSkills,
          agents: availableAgents,
        });

        const chosen: SkillMatch | undefined = resolution.outcome === "selected" ? resolution.match : undefined;

        // A skill's own requirements become the step's, so routing and
        // governance see them whether or not the planner listed them.
        const requiredTools = [...new Set([
          ...(plannedTask.requiredTools ?? []),
          ...(chosen?.skill.requiredTools ?? []).filter((tool) => knownTools.size === 0 || knownTools.has(tool)),
        ])];
        const requiredCapabilities = [...new Set([
          ...(plannedTask.requiredCapabilities ?? []),
          ...(chosen?.skill.requiredCapabilities ?? []).map((capability) => capability.toLocaleLowerCase()),
        ])];

        const delegation =
          await this.delegator.delegate({
            workId: updatedWork.id,

            task: {
              ...plannedTask,
              skill: chosen?.skill.slug,
              requiredTools,
              requiredCapabilities,
            },

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
        // rather than from anything the planner wrote. The version is kept
        // as it is now, so running the step later runs this version of it.
        const appliedSlug = typeof delegation.metadata.skill === "string" ? delegation.metadata.skill : undefined;
        const applied = chosen && appliedSlug === chosen.skill.slug
          ? (this.skills?.pin ? await this.skills.pin(updatedWork.organizationId, chosen.skill) : chosen.skill)
          : undefined;

        // Why this step has no skill, in the words the mission will show.
        const skillNote = applied
          ? undefined
          : chosen
            ? `${chosen.skill.name} was selected, but the step went to an agent that does not hold it.`
            : resolution.outcome === "selected" ? undefined : resolution.reason;

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
              requiredCapabilities,
              requiredTools,
              suggestedAgentType:
                plannedTask.suggestedAgentType,
              skill: applied
                ? {
                    ref: skillRefOf(applied),
                    slug: applied.slug,
                    name: applied.name,
                    version: applied.version,
                    scope: applied.scope,
                    approval: applied.approval,
                    memory: applied.memory,
                    reasons: chosen?.reasons ?? [],
                  }
                : undefined,
              skillNote,
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
