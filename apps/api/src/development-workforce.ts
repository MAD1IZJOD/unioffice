import {
  type Agent,
  type AgentId,
  type Organization,
  type OrganizationId,
  type Workspace,
  type WorkspaceId,
} from "@unioffice/core";

import type {
  AgentRepository,
  OrganizationRepository,
  WorkspaceRepository,
} from "@unioffice/database";

const developmentOrganization = {
  id: "2f6b579a-f0f8-45a5-868a-21c08bde1314" as OrganizationId,
  slug: "unioffice-development",
  name: "UNI-OFFICE Development",
};

/**
 * The rooms seeded agents sit in. Each is found by its slug, so a workspace
 * the company already made - Engineering, Research and the rest - is used as
 * it is; only one that does not exist yet is created, with this id.
 */
export const SEED_WORKSPACES = {
  engineering: {
    id: "e32813a2-dda6-4a89-a756-c2991510d001",
    name: "Engineering",
    description: "Builds, tests and runs the product.",
  },
  product: {
    id: "e32813a2-dda6-4a89-a756-c2991510d002",
    name: "Product",
    description: "Decides what the product should do next, and why.",
  },
  research: {
    id: "e32813a2-dda6-4a89-a756-c2991510d003",
    name: "Research",
    description: "Finds out what is true before the company decides.",
  },
  "revenue-growth": {
    id: "e32813a2-dda6-4a89-a756-c2991510d004",
    name: "Revenue & Growth",
    description: "Wins customers, and grows how many find and choose the product.",
  },
  operations: {
    id: "e32813a2-dda6-4a89-a756-c2991510d005",
    name: "Operations",
    description: "Keeps projects moving and the company supplied.",
  },
  "customer-success": {
    id: "e32813a2-dda6-4a89-a756-c2991510d006",
    name: "Customer Success",
    description: "Looks after customers once they have chosen the product.",
  },
} satisfies Record<string, { id: string; name: string; description: string }>;

export type SeedWorkspace = keyof typeof SEED_WORKSPACES;

export interface Blueprint {
  id: string;
  name: string;
  type: "orchestrator" | "specialist";
  description: string;
  capabilities: string[];
  toolIds: string[];
  skills: string[];
  /**
   * The job, as the company would name it - "Backend Engineer". The first
   * six were seeded without one and read their role from their capabilities.
   */
  role?: string;
  /** The room the agent works in, by its workspace's slug. None is the company hall. */
  workspace?: SeedWorkspace;
}

// Capabilities are the planner's routing vocabulary, so they have to
// discriminate. An earlier version gave five of six agents both "analysis"
// and "writing", which made every specialist look identical for most tasks
// and handed all of them to whichever agent won the id tie-break. Each agent
// now owns a capability nobody else has, and shares only what it genuinely
// shares.
//
// Tools and skills are only ones that exist: the default tool registry's, and
// system skills whose required capabilities and tools the agent holds - a
// skill it could not use would be a promise, not a profile.
export const workforce: Blueprint[] = [
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c501",
    name: "Tyrion",
    type: "orchestrator" as const,
    description: "Reads the objective, decides the order of the work, routes each task to whoever can actually do it, and holds the outcome together.",
    capabilities: ["planning", "coordination", "decision_support"],
    toolIds: [] as string[],
    skills: [] as string[],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c502",
    name: "Tony",
    type: "specialist" as const,
    description: "Builds. Engineering analysis, technical design and structured data transformation.",
    capabilities: ["coding", "technical_design", "data_transformation"],
    toolIds: ["calculator", "datetime", "json_transform"],
    skills: ["code-review", "debugging", "api-design", "database-investigation", "test-generation", "incident-analysis"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c503",
    name: "Harvey",
    type: "specialist" as const,
    description: "Runs the numbers exactly. Calculation, financial analysis and quantitative decision support.",
    capabilities: ["calculation", "financial_analysis", "decision_support"],
    toolIds: ["calculator", "datetime"],
    skills: ["financial-analysis", "budget-review", "variance-analysis", "forecasting"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c504",
    name: "Mike",
    type: "specialist" as const,
    description: "Works the question over: reads the supplied context and company memory, synthesises what it finds and writes the analysis.",
    capabilities: ["research", "synthesis", "writing"],
    toolIds: ["datetime", "json_transform"],
    skills: ["web-research", "competitor-analysis", "source-synthesis", "briefing-generation", "meeting-summary"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c505",
    name: "Jamie",
    type: "specialist" as const,
    description: "Handles people operations, process design and the internal ways of working the company runs on.",
    capabilities: ["people_operations", "process_design", "writing"],
    toolIds: ["datetime"],
    skills: ["candidate-screening", "onboarding-planning", "policy-drafting", "employee-communication"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c506",
    name: "Peter",
    type: "specialist" as const,
    description: "Turns what the company knows into clear customer and stakeholder messages. Drafts them; never sends anything externally.",
    capabilities: ["communication", "stakeholder_messaging", "writing"],
    toolIds: ["datetime"],
    skills: ["executive-briefing", "stakeholder-update", "announcement-drafting", "meeting-summary"],
  },
];

/**
 * Twelve more agents, proposed and not yet approved - their names in
 * particular. They are never created on boot: nothing provisions them until
 * someone passes them to `ensureDevelopmentWorkforce` on purpose, so a
 * restart of an API that seeds cannot put unapproved people into a real
 * company. Tests exercise them exactly as they would be provisioned.
 */
export const proposedWorkforce: Blueprint[] = [
  /* Engineering ------------------------------------------------------------ */
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c507",
    name: "Wanda",
    type: "specialist",
    role: "Frontend Engineer",
    workspace: "engineering",
    description:
      "Builds what people see and use: interface components, page behaviour, state in the browser and accessibility. Reviews front-end changes and finds why a screen misbehaves.",
    capabilities: ["frontend_development", "coding"],
    toolIds: ["datetime", "json_transform"],
    skills: ["code-review", "debugging", "test-generation"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c508",
    name: "Bruce",
    type: "specialist",
    role: "Backend Engineer",
    workspace: "engineering",
    description:
      "Builds and maintains the services behind the product: API endpoints, data models, integrations and the flows between them. Designs interfaces, investigates data problems and reviews backend changes.",
    capabilities: ["backend_development", "coding", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["api-design", "database-investigation", "code-review", "debugging"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c509",
    name: "Natasha",
    type: "specialist",
    role: "QA Engineer",
    workspace: "engineering",
    description:
      "Decides what has to be true before a change ships and checks it: writes test cases, reproduces reported defects, narrows down where they come from and reviews changes for what they could break.",
    capabilities: ["quality_assurance", "coding"],
    toolIds: ["datetime", "json_transform"],
    skills: ["test-generation", "debugging", "code-review"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c510",
    name: "Sam",
    type: "specialist",
    role: "DevOps Engineer",
    workspace: "engineering",
    description:
      "Keeps the product deployed and running: release and environment plans, reliability reviews and incident timelines. Works out what failed, when, and what would stop it happening again.",
    capabilities: ["infrastructure_operations", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["incident-analysis", "database-investigation"],
  },

  /* Product ---------------------------------------------------------------- */
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c511",
    name: "Jessica",
    type: "specialist",
    role: "Product Manager",
    workspace: "product",
    description:
      "Decides what gets built next and why: turns goals and feedback into prioritised requirements, writes the scope and acceptance criteria, and keeps the people involved informed of decisions and trade-offs.",
    capabilities: ["product_management", "stakeholder_messaging", "writing"],
    toolIds: ["datetime"],
    skills: ["stakeholder-update", "meeting-summary"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c512",
    name: "Rachel",
    type: "specialist",
    role: "Product Researcher",
    workspace: "research",
    description:
      "Finds out what users and the market need before the product changes: studies competitors and market size from the material supplied, synthesises feedback and research into findings the product team can act on.",
    capabilities: ["product_research", "research", "synthesis"],
    toolIds: ["calculator", "datetime"],
    skills: ["market-research", "competitor-analysis", "source-synthesis"],
  },

  /* Revenue and growth ------------------------------------------------------ */
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c513",
    name: "Donna",
    type: "specialist",
    role: "Account Executive",
    workspace: "revenue-growth",
    description:
      "Turns interest into signed customers: qualifies opportunities, prepares proposals and pricing from the figures supplied, and writes the follow-ups and account updates. Drafts them; never sends anything externally.",
    capabilities: ["sales", "stakeholder_messaging", "writing"],
    toolIds: ["calculator", "datetime"],
    skills: ["stakeholder-update", "meeting-summary"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c514",
    name: "Louis",
    type: "specialist",
    role: "Marketing Manager",
    workspace: "revenue-growth",
    description:
      "Decides how the product is positioned and announced: messaging, campaign plans and launch material, written for the audience each one is meant for. Drafts them; never publishes anything externally.",
    capabilities: ["marketing", "communication", "writing"],
    toolIds: ["datetime"],
    skills: ["announcement-drafting", "briefing-generation"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c515",
    name: "Sansa",
    type: "specialist",
    role: "Growth & Content Lead",
    workspace: "revenue-growth",
    description:
      "Grows how many people find and keep using the product: plans content, writes articles and guides, and reads the acquisition and retention figures supplied to decide what to try next.",
    capabilities: ["content_creation", "growth_analysis", "writing"],
    toolIds: ["calculator", "datetime"],
    skills: ["briefing-generation"],
  },

  /* Operations -------------------------------------------------------------- */
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c516",
    name: "Brienne",
    type: "specialist",
    role: "Project Coordinator",
    workspace: "operations",
    description:
      "Keeps cross-team work on schedule: turns plans into timelines and owners, tracks dependencies and deadlines, and writes the status notes and meeting summaries that say what is late and what it is waiting on.",
    capabilities: ["project_coordination", "scheduling", "writing"],
    toolIds: ["datetime"],
    skills: ["meeting-summary"],
  },
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c517",
    name: "Davos",
    type: "specialist",
    role: "Procurement & Vendor Manager",
    workspace: "operations",
    description:
      "Buys what the company needs at the right price: compares vendor quotes and terms from the documents supplied, forecasts spend, tracks renewals and prepares the purchase recommendation. Never commits the company to a purchase.",
    capabilities: ["procurement", "vendor_management", "calculation"],
    toolIds: ["calculator", "datetime"],
    skills: ["forecasting"],
  },

  /* Customer ---------------------------------------------------------------- */
  {
    id: "e32813a2-dda6-4a89-a756-c2991510c518",
    name: "Katrina",
    type: "specialist",
    role: "Customer Support Specialist",
    workspace: "customer-success",
    description:
      "Resolves what customers bring in: works out what went wrong from the ticket and the context supplied, writes clear replies and troubleshooting steps, and summarises recurring problems for the product team. Drafts replies; never sends them.",
    capabilities: ["customer_support", "customer_communication", "writing"],
    toolIds: ["datetime"],
    skills: ["meeting-summary"],
  },
];

export async function ensureDevelopmentWorkforce(
  organizationRepository: OrganizationRepository,
  agentRepository: AgentRepository,
  workspaceRepository: WorkspaceRepository,
  /** Who to seed. The boot seed is the first six only; anyone else is passed on purpose. */
  blueprints: readonly Blueprint[] = workforce,
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

  const rooms = await ensureSeedWorkspaces(
    workspaceRepository,
    organization.id,
    new Set(blueprints.flatMap((blueprint) => (blueprint.workspace ? [blueprint.workspace] : []))),
    now,
  );

  for (const blueprint of blueprints) {
    const toolIds = blueprint.toolIds;
    const workspaceId = blueprint.workspace ? rooms.get(blueprint.workspace) : undefined;
    const systemInstructions = [
      blueprint.role
        ? `You are ${blueprint.name}, the UNIOFFICE ${blueprint.role}.`
        : `You are ${blueprint.name}, a UNIOFFICE ${blueprint.type}.`,
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
        ...(workspaceId ? { workspaceId } : {}),
        name: blueprint.name,
        description: blueprint.description,
        type: blueprint.type,
        status: "active",
        capabilities: blueprint.capabilities,
        toolIds,
        skills: blueprint.skills,
        createdAt: now,
        updatedAt: now,
        metadata: {
          developmentSeed: true,
          systemInstructions,
          ...(blueprint.role ? { role: blueprint.role } : {}),
        },
      });
      continue;
    }

    // Once a person has configured an agent through the product, the seed
    // stops owning it. Re-syncing a user-edited row on the next boot would
    // silently throw their capabilities and tool grants away, which is a far
    // worse failure than a seeded agent drifting from its blueprint.
    if (currentAgent.metadata.userConfigured) {
      continue;
    }

    // The blueprint (capabilities, granted tools, instructions) can change
    // between deploys; an agent seeded before toolIds existed must not be
    // stuck without them forever just because its row already exists.
    const isOutOfDate =
      currentAgent.name !== blueprint.name ||
      JSON.stringify([...currentAgent.toolIds].sort()) !== JSON.stringify([...toolIds].sort()) ||
      JSON.stringify([...currentAgent.capabilities].sort()) !== JSON.stringify([...blueprint.capabilities].sort()) ||
      JSON.stringify([...(currentAgent.skills ?? [])].sort()) !== JSON.stringify([...blueprint.skills].sort()) ||
      currentAgent.description !== blueprint.description ||
      currentAgent.metadata.systemInstructions !== systemInstructions ||
      // Only blueprints that name a room or a role own them; the first six
      // never did, so whatever they have is left as it is.
      (blueprint.workspace !== undefined && currentAgent.workspaceId !== workspaceId) ||
      (blueprint.role !== undefined && currentAgent.metadata.role !== blueprint.role);

    if (isOutOfDate) {
      await agentRepository.update({
        ...currentAgent,
        ...(blueprint.workspace !== undefined ? { workspaceId } : {}),
        name: blueprint.name,
        description: blueprint.description,
        capabilities: blueprint.capabilities,
        toolIds,
        skills: blueprint.skills,
        updatedAt: now,
        metadata: {
          ...currentAgent.metadata,
          developmentSeed: true,
          systemInstructions,
          ...(blueprint.role !== undefined ? { role: blueprint.role } : {}),
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

/**
 * The rooms the blueprints need, by slug. A workspace the organization
 * already has is used as it is - never renamed or moved - and only a missing
 * one is created, under the seed's own id for it.
 */
async function ensureSeedWorkspaces(
  workspaceRepository: WorkspaceRepository,
  organizationId: OrganizationId,
  needed: ReadonlySet<SeedWorkspace>,
  now: Date,
): Promise<Map<SeedWorkspace, WorkspaceId>> {
  const rooms = new Map<SeedWorkspace, WorkspaceId>();

  for (const slug of [...needed].sort()) {
    const existing = await workspaceRepository.findBySlug(organizationId, slug);
    if (existing) {
      rooms.set(slug, existing.id);
      continue;
    }

    const seed = SEED_WORKSPACES[slug];
    const created: Workspace = await workspaceRepository.create({
      id: seed.id as WorkspaceId,
      organizationId,
      name: seed.name,
      slug,
      description: seed.description,
      status: "active",
      createdAt: now,
      updatedAt: now,
      metadata: { developmentSeed: true },
    });
    rooms.set(slug, created.id);
  }

  return rooms;
}
