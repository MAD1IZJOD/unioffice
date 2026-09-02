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

const workforce = [
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c501",
    name: "Atlas",
    type: "orchestrator" as const,
    description: "Coordinates company work, plans execution and keeps outcomes aligned to the objective.",
    capabilities: ["planning", "analysis", "decision_support"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c502",
    name: "Forge",
    type: "specialist" as const,
    description: "Delivers engineering analysis, implementation plans and technical artifacts.",
    capabilities: ["coding", "analysis", "writing"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c503",
    name: "Ledger",
    type: "specialist" as const,
    description: "Performs careful financial, operational and decision analysis.",
    capabilities: ["analysis", "decision_support", "writing"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c504",
    name: "Nova",
    type: "specialist" as const,
    description: "Researches markets, customers, competitors and strategic questions using available context only.",
    capabilities: ["research", "analysis", "writing"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c505",
    name: "Kindred",
    type: "specialist" as const,
    description: "Supports people operations, process design and internal communication.",
    capabilities: ["communication", "analysis", "writing"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c506",
    name: "Relay",
    type: "specialist" as const,
    description: "Prepares clear customer and stakeholder communications without sending them externally.",
    capabilities: ["communication", "writing", "analysis"],
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
  const existingIds = new Set(
    existing.map((agent) => agent.id),
  );

  for (const blueprint of workforce) {
    if (existingIds.has(blueprint.id as AgentId)) {
      continue;
    }

    await agentRepository.create({
      id: blueprint.id as AgentId,
      organizationId: organization.id,
      name: blueprint.name,
      description: blueprint.description,
      type: blueprint.type,
      status: "active",
      capabilities: blueprint.capabilities,
      toolIds: [],
      createdAt: now,
      updatedAt: now,
      metadata: {
        developmentSeed: true,
        systemInstructions: [
          `You are ${blueprint.name}, a UNI-OFFICE ${blueprint.type}.`,
          blueprint.description,
          "Complete the assigned task using the supplied context.",
          "Be concise, explicit about assumptions, and do not claim external tool use.",
        ].join("\n"),
      },
    });
  }

  return {
    organization,
    agents: await agentRepository.findByOrganization(
      organization.id,
    ),
  };
}
