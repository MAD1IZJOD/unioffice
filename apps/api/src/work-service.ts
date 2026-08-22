import type {
  Agent,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  AgentRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  Planner,
  WorkPlan,
} from "@unioffice/orchestrator";

export interface PlanWorkResult {
  work: Work;

  plan: WorkPlan;
}

export class WorkService {
  constructor(
    private readonly workRepository: WorkRepository,

    private readonly agentRepository: AgentRepository,

    private readonly planner: Planner,
  ) {}

  async planWork(
    workId: WorkId,
  ): Promise<PlanWorkResult> {
    const work =
      await this.workRepository.findById(workId);

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

    const availableAgents: Agent[] =
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

    return {
      work: updatedWork,

      plan,
    };
  }
}