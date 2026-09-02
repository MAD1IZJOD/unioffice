import type {
  Agent,
} from "@unioffice/core";

import type {
  AgentDefinition,
} from "@unioffice/agents";

export function agentToDefinition(
  agent: Agent,
): AgentDefinition {
  const configuredInstructions =
    agent.metadata.systemInstructions;

  return {
    id: agent.id,

    name: agent.name,

    description:
      agent.description,

    type: agent.type,

    systemInstructions:
      typeof configuredInstructions === "string" &&
      configuredInstructions.trim()
        ? configuredInstructions
        : [
            `You are ${agent.name}.`,
            agent.description,
            "Only claim work you actually performed.",
            "You do not have tools unless they are explicitly listed.",
          ].join("\n"),

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
