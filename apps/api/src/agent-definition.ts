import type {
  Agent,
} from "@unioffice/core";

import type {
  AgentDefinition,
} from "@unioffice/agents";

export function agentToDefinition(
  agent: Agent,
): AgentDefinition {
  return {
    id: agent.id,

    name: agent.name,

    description:
      agent.description,

    type: agent.type,

    systemInstructions:
      `You are ${agent.name}. ${agent.description}`,

    capabilities:
      agent.capabilities,

    toolIds:
      agent.toolIds,

    constraints: {},

    metadata: {
      ...agent.metadata,
    },
  };
}