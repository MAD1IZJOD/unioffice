import {
  type Agent,
  type AgentId,
  type Organization,
  type OrganizationId,
} from "@unioffice/core";

import type {
  AgentRepository,
  OrganizationRepository,
} from "@unioffice/database";

const developmentOrganization = {
  id: "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId,
  slug: "unioffice-development",
  name: "UNI-OFFICE Development",
};

// Capabilities are the planner's routing vocabulary, so they have to
// discriminate. An earlier version gave five of six agents both "analysis"
// and "writing", which made every specialist look identical for most tasks
// and handed all of them to whichever agent won the id tie-break. Each agent
// now owns a capability nobody else has, and shares only what it genuinely
// shares.
const workforce = [
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c501",
    name: "Atlas",
    type: "orchestrator" as const,
    description: "Coordinates company work, sequences execution and keeps outcomes aligned to the objective.",
    capabilities: ["planning", "coordination", "decision_support"],
    toolIds: [] as string[],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c502",
    name: "Forge",
    type: "specialist" as const,
    description: "Delivers engineering analysis, technical design and structured data transformation.",
    capabilities: ["coding", "technical_design", "data_transformation"],
    toolIds: ["calculator", "datetime", "json_transform"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c503",
    name: "Ledger",
    type: "specialist" as const,
    description: "Performs exact calculation and financial, operational and decision analysis.",
    capabilities: ["calculation", "financial_analysis", "decision_support"],
    toolIds: ["calculator", "datetime"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c504",
    name: "Nova",
    type: "specialist" as const,
    description: "Researches markets, customers, competitors and strategic questions, and synthesises findings.",
    capabilities: ["research", "synthesis", "writing"],
    toolIds: ["datetime", "json_transform"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c505",
    name: "Kindred",
    type: "specialist" as const,
    description: "Supports people operations, process design and internal ways of working.",
    capabilities: ["people_operations", "process_design", "writing"],
    toolIds: ["datetime"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c506",
    name: "Relay",
    type: "specialist" as const,
    description: "Prepares clear customer and stakeholder communication without sending anything externally.",
    capabilities: ["communication", "stakeholder_messaging", "writing"],
    toolIds: ["datetime"],
  },
];

export async function ensureDevelopmentWorkforce(
  organizationRepository: OrganizationRepository,
  agentRepository: AgentRepository,
): Promise<{
  organization: Organization;
  agents: Agent[];
}> {
  const now = new Date();
  let organization =
    await organizationRepository.findBySlug(
      developmentOrganization.slug,
    );

  if (!organization) {
    organization = await organizationRepository.create({
      ...developmentOrganization,
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata: {
        developmentSeed: true,
      },
    });
  }

  const existing =
    await agentRepository.findByOrganization(
      organization.id,
    );
  const existingById = new Map(
    existing.map((agent) => [agent.id, agent]),
  );

  for (const blueprint of workforce) {
    const toolIds = blueprint.toolIds;
    const systemInstructions = [
      `You are ${blueprint.name}, a UNI-OFFICE ${blueprint.type}.`,
      blueprint.description,
      "Complete the assigned task using the supplied context.",
      "Be concise. Lead with the answer, and surface an assumption only when a different one would change it.",
      toolIds.length > 0
        ? "Use your available tools for calculations or lookups instead of guessing; never claim to have used a tool you did not actually call."
        : "You do not have tools unless they are explicitly listed. Do not claim external tool use.",
    ].join("\n");

    const currentAgent = existingById.get(blueprint.id as AgentId);

    if (!currentAgent) {
      await agentRepository.create({
        id: blueprint.id as AgentId,
        organizationId: organization.id,
        name: blueprint.name,
        description: blueprint.description,
        type: blueprint.type,
        status: "active",
        capabilities: blueprint.capabilities,
        toolIds,
        createdAt: now,
        updatedAt: now,
        metadata: {
          developmentSeed: true,
          systemInstructions,
        },
      });
      continue;
    }

    // The blueprint (capabilities, granted tools, instructions) can change
    // between deploys; an agent seeded before toolIds existed must not be
    // stuck without them forever just because its row already exists.
    const isOutOfDate =
      JSON.stringify([...currentAgent.toolIds].sort()) !== JSON.stringify([...toolIds].sort()) ||
      JSON.stringify([...currentAgent.capabilities].sort()) !== JSON.stringify([...blueprint.capabilities].sort()) ||
      currentAgent.description !== blueprint.description ||
      currentAgent.metadata.systemInstructions !== systemInstructions;

    if (isOutOfDate) {
      await agentRepository.update({
        ...currentAgent,
        description: blueprint.description,
        capabilities: blueprint.capabilities,
        toolIds,
        updatedAt: now,
        metadata: {
          ...currentAgent.metadata,
          developmentSeed: true,
          systemInstructions,
        },
      });
    }
  }

  return {
    organization,
    agents: await agentRepository.findByOrganization(
      organization.id,
    ),
  };
}
