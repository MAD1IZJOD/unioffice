import type {
  AgentRepository,
} from "@unioffice/database";

import type {
  DelegatedTask,
  DelegationContext,
  Delegator,
} from "./delegator.js";

export class DefaultDelegator
  implements Delegator
{
  constructor(
    private readonly agentRepository: AgentRepository,
  ) {}

  async delegate(
    context: DelegationContext,
  ): Promise<DelegatedTask> {
    const agents =
      await this.agentRepository.findByOrganization(
        context.organizationId,
      );

    const availableAgents =
      agents.filter(
        (agent) =>
          agent.status === "active" &&
          (
            !context.workspaceId ||
            !agent.workspaceId ||
            agent.workspaceId ===
              context.workspaceId
          ),
      );

    if (context.task.assignedAgentId) {
      const assignedAgent =
        availableAgents.find(
          (agent) =>
            agent.id ===
            context.task.assignedAgentId,
        );

      if (!assignedAgent) {
        throw new Error(
          `Assigned agent is unavailable: ${context.task.assignedAgentId}`,
        );
      }

      return {
        taskId: context.task.id,

        agentId:
          assignedAgent.id,

        metadata: {
          delegation: "explicit",
        },
      };
    }

    const agent =
      availableAgents[0];

    if (!agent) {
      throw new Error(
        "No eligible agents available for task",
      );
    }

    return {
      taskId: context.task.id,

      agentId:
        agent.id,

      metadata: {
        delegation: "default",
      },
    };
  }
}