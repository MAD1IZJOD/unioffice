import type { Blueprint } from "./development-workforce.js";

/**
 * The workforce beyond the first twenty, by department.
 *
 * Each agent owns a capability nobody else holds, so the delegator can tell
 * it apart, and shares only what it genuinely shares. Ties in the delegator's
 * rank go to the lower id, and these ids come after everyone already here,
 * so an existing agent keeps the work it already does; a newcomer takes the
 * work it matches better. Tools are the built-in registry's only, and every
 * skill is one the agent's capabilities and tools let it use.
 *
 * Ids run on from the twelve before them: ...c519 onwards, never reused.
 */

const id = (n: number) => `e32813a2-dda6-4a89-a756-c2991510c${String(n).padStart(3, "0")}`;

/* Engineering -------------------------------------------------------------- */

export const engineeringExpansion: Blueprint[] = [
  {
    id: id(519),
    name: "Alex",
    type: "specialist",
    role: "Full-Stack Engineer",
    workspace: "engineering",
    description:
      "Builds features end to end: the screen, the endpoint behind it and the data between them. Takes the work that crosses the front and back of the product, and reviews changes that touch both.",
    capabilities: ["full_stack_development", "frontend_development", "backend_development", "coding"],
    toolIds: ["datetime", "json_transform"],
    skills: ["code-review", "debugging", "test-generation"],
  },
  {
    id: id(520),
    name: "Maya",
    type: "specialist",
    role: "ML Engineer",
    workspace: "engineering",
    description:
      "Designs, trains and evaluates machine-learning models from the data supplied: chooses features and metrics, reads evaluation results, and explains what a model can and cannot be trusted to do.",
    capabilities: ["machine_learning", "coding", "technical_design"],
    toolIds: ["calculator", "datetime", "json_transform"],
    skills: ["code-review", "debugging", "database-investigation"],
  },
  {
    id: id(521),
    name: "Leo",
    type: "specialist",
    role: "AI Engineer",
    workspace: "engineering",
    description:
      "Builds the product's AI features and agents: prompts, tool use, evaluation of model output and the interfaces around them. Works out why an agent answered badly and what would make it reliable.",
    capabilities: ["ai_engineering", "coding", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["api-design", "code-review", "debugging"],
  },
  {
    id: id(522),
    name: "Elena",
    type: "specialist",
    role: "Data Engineer",
    workspace: "engineering",
    description:
      "Builds the pipelines that move and shape the company's data: ingestion, transformation, schemas and data quality checks. Investigates where data went missing or wrong and designs the fix.",
    capabilities: ["data_engineering", "coding", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["database-investigation", "code-review", "debugging"],
  },
  {
    id: id(523),
    name: "Ryan",
    type: "specialist",
    role: "MLOps Engineer",
    workspace: "engineering",
    description:
      "Takes models from a notebook to production and keeps them healthy there: training and release pipelines, model monitoring, drift and rollback plans, and the incidents when a model misbehaves.",
    capabilities: ["mlops", "infrastructure_operations", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["incident-analysis", "database-investigation"],
  },
  {
    id: id(524),
    name: "Chloe",
    type: "specialist",
    role: "Security Engineer",
    workspace: "engineering",
    description:
      "Finds and fixes security weaknesses before someone else does: threat models, secure code review, access and secrets handling, and the timeline and follow-up of a security incident.",
    capabilities: ["security_engineering", "coding", "technical_design"],
    toolIds: ["datetime"],
    skills: ["code-review", "incident-analysis", "debugging"],
  },
  {
    id: id(525),
    name: "Ethan",
    type: "specialist",
    role: "Platform Engineer",
    workspace: "engineering",
    description:
      "Builds the internal platform the other engineers ship on: build and deploy tooling, shared services and their interfaces, and the paved road that makes the right way the easy way.",
    capabilities: ["platform_engineering", "infrastructure_operations", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["api-design", "incident-analysis"],
  },
  {
    id: id(526),
    name: "Olivia",
    type: "specialist",
    role: "Cloud Engineer",
    workspace: "engineering",
    description:
      "Designs and runs the product's cloud infrastructure: environments, networking, storage and cost. Plans capacity from the figures supplied and works out what a change to the infrastructure will cost.",
    capabilities: ["cloud_infrastructure", "infrastructure_operations", "technical_design"],
    toolIds: ["calculator", "datetime"],
    skills: ["incident-analysis", "database-investigation"],
  },
  {
    id: id(527),
    name: "Noah",
    type: "specialist",
    role: "SRE",
    workspace: "engineering",
    description:
      "Keeps the product up: sets reliability targets and error budgets, reads incident timelines to find the cause, and writes the postmortem and the changes that stop it happening again.",
    capabilities: ["site_reliability", "infrastructure_operations", "technical_design"],
    toolIds: ["calculator", "datetime"],
    skills: ["incident-analysis"],
  },
  {
    id: id(528),
    name: "Arjun",
    type: "specialist",
    role: "Performance Engineer",
    workspace: "engineering",
    description:
      "Makes the product fast and keeps it that way: reads profiles and timings, finds the slow query or the wasted work, and measures whether a change actually made things faster.",
    capabilities: ["performance_engineering", "coding", "technical_design"],
    toolIds: ["calculator", "datetime"],
    skills: ["debugging", "database-investigation"],
  },
  {
    id: id(529),
    name: "Sophie",
    type: "specialist",
    role: "Mobile Engineer",
    workspace: "engineering",
    description:
      "Builds and maintains the mobile apps: screens, offline behaviour, device quirks and releases to the app stores. Reviews mobile changes and finds why the app misbehaves on one device and not another.",
    capabilities: ["mobile_development", "coding"],
    toolIds: ["datetime", "json_transform"],
    skills: ["code-review", "debugging", "test-generation"],
  },
  {
    id: id(530),
    name: "Liam",
    type: "specialist",
    role: "Integration Engineer",
    workspace: "engineering",
    description:
      "Connects the product to the systems around it: third-party APIs, webhooks, data syncs and the contracts between them. Designs the interface, maps the data across and finds where a sync breaks.",
    capabilities: ["systems_integration", "backend_development", "technical_design"],
    toolIds: ["datetime", "json_transform"],
    skills: ["api-design", "database-investigation"],
  },
];

/** Everyone beyond the first twenty, in the order they are provisioned. */
export const expandedWorkforce: Blueprint[] = [
  ...engineeringExpansion,
];
