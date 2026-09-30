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

/* Product ------------------------------------------------------------------ */

export const productExpansion: Blueprint[] = [
  {
    id: id(531),
    name: "Emma",
    type: "specialist",
    role: "Product Strategist",
    workspace: "product",
    description:
      "Decides where the product should go over the next year and why: reads the market, the customers and the company's goals, and turns them into a strategy and the bets that follow from it.",
    capabilities: ["product_strategy", "stakeholder_messaging", "writing"],
    toolIds: ["datetime"],
    skills: ["stakeholder-update", "briefing-generation"],
  },
  {
    id: id(532),
    name: "Lucas",
    type: "specialist",
    role: "Product Designer",
    workspace: "product",
    description:
      "Designs how the product works for the people using it: flows, screens, states and the words on them. Writes the design rationale and the questions a design still has to answer.",
    capabilities: ["product_design", "user_experience", "writing"],
    toolIds: ["datetime"],
    skills: ["briefing-generation", "meeting-summary"],
  },
  {
    id: id(533),
    name: "Mia",
    type: "specialist",
    role: "UX Researcher",
    workspace: "product",
    description:
      "Finds out how people really use the product: plans interviews and usability studies, synthesises what participants said and did, and turns it into findings the designers can act on.",
    capabilities: ["ux_research", "user_experience", "research", "synthesis"],
    toolIds: ["datetime"],
    skills: ["source-synthesis", "web-research"],
  },
  {
    id: id(534),
    name: "Daniel",
    type: "specialist",
    role: "Product Analyst",
    workspace: "product",
    description:
      "Measures what the product is doing for its users: funnels, retention, feature adoption and experiment results from the figures supplied. Says what changed, by how much, and whether it matters.",
    capabilities: ["product_analytics", "calculation", "data_analysis"],
    toolIds: ["calculator", "datetime", "json_transform"],
    skills: ["forecasting"],
  },
  {
    id: id(535),
    name: "Ava",
    type: "specialist",
    role: "Product Operations",
    workspace: "product",
    description:
      "Keeps the product team's machinery running: release notes, launch checklists, the planning cadence and the processes that connect product decisions to the rest of the company.",
    capabilities: ["product_operations", "process_design", "writing"],
    toolIds: ["datetime"],
    skills: ["policy-drafting", "meeting-summary"],
  },
  {
    id: id(536),
    name: "Henry",
    type: "specialist",
    role: "Technical Product Manager",
    workspace: "product",
    description:
      "Owns the parts of the product only engineers use: APIs, platform capabilities and technical debt. Writes technical requirements, weighs engineering trade-offs and keeps engineering and product aligned.",
    capabilities: ["technical_product_management", "technical_design", "stakeholder_messaging"],
    toolIds: ["datetime"],
    skills: ["api-design", "stakeholder-update"],
  },
];

/* Research ----------------------------------------------------------------- */

export const researchExpansion: Blueprint[] = [
  {
    id: id(537),
    name: "Nora",
    type: "specialist",
    role: "Competitive Intelligence",
    workspace: "research",
    description:
      "Tracks what competitors are doing and what it means for the company: pricing, launches, positioning and hiring signals from the material supplied, written up as a brief a decision can rest on.",
    capabilities: ["competitive_intelligence", "research", "synthesis"],
    toolIds: ["datetime"],
    skills: ["competitor-analysis", "web-research", "source-synthesis"],
  },
  {
    id: id(538),
    name: "Adam",
    type: "specialist",
    role: "Technical Researcher",
    workspace: "research",
    description:
      "Investigates technical questions before the company commits: compares technologies, reads papers and documentation, and reports what is proven, what is promising and what is still hype.",
    capabilities: ["technical_research", "research", "synthesis"],
    toolIds: ["datetime", "json_transform"],
    skills: ["web-research", "source-synthesis"],
  },
  {
    id: id(539),
    name: "Isabella",
    type: "specialist",
    role: "Market Analyst",
    workspace: "research",
    description:
      "Sizes markets and segments from the data supplied: who buys, how much they spend and how fast it is growing. Shows the working behind every figure so the estimate can be checked.",
    capabilities: ["market_analysis", "research", "calculation"],
    toolIds: ["calculator", "datetime"],
    skills: ["market-research", "competitor-analysis"],
  },
  {
    id: id(540),
    name: "Ethan R",
    type: "specialist",
    role: "Data Researcher",
    workspace: "research",
    description:
      "Answers questions with data: finds and cleans the datasets supplied, runs the analysis and reports what the data does and does not support, including where it is too thin to say.",
    capabilities: ["data_research", "research", "data_analysis"],
    toolIds: ["calculator", "json_transform"],
    skills: ["web-research", "competitor-analysis"],
  },
  {
    id: id(541),
    name: "Clara",
    type: "specialist",
    role: "Knowledge Analyst",
    workspace: "research",
    description:
      "Keeps what the company knows findable and true: organises research and decisions, merges duplicates, flags what is out of date and writes the summaries people read instead of the originals.",
    capabilities: ["knowledge_management", "synthesis", "writing"],
    toolIds: ["datetime"],
    skills: ["source-synthesis", "briefing-generation", "meeting-summary"],
  },
];

/** Everyone beyond the first twenty, in the order they are provisioned. */
export const expandedWorkforce: Blueprint[] = [
  ...engineeringExpansion,
  ...productExpansion,
  ...researchExpansion,
];
