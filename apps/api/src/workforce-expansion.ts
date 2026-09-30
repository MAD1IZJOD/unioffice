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

/* Revenue and growth ------------------------------------------------------- */

export const revenueExpansion: Blueprint[] = [
  {
    id: id(542),
    name: "Ryan R",
    type: "specialist",
    role: "Sales Development",
    workspace: "revenue-growth",
    description:
      "Finds and opens new conversations: researches target accounts, qualifies inbound interest and writes the first outreach and follow-ups that get a meeting booked. Drafts them; never sends anything externally.",
    capabilities: ["sales_development", "prospecting", "writing"],
    toolIds: ["datetime"],
    skills: ["meeting-summary", "briefing-generation"],
  },
  {
    id: id(543),
    name: "Grace",
    type: "specialist",
    role: "Account Executive",
    workspace: "revenue-growth",
    description:
      "Runs deals from first meeting to signature for her accounts: discovery notes, proposals and pricing from the figures supplied, and the account updates that keep everyone on the buyer's side aligned. Drafts them; never sends anything externally.",
    capabilities: ["account_management", "sales", "stakeholder_messaging", "writing"],
    toolIds: ["calculator", "datetime"],
    skills: ["stakeholder-update", "meeting-summary"],
  },
  {
    id: id(544),
    name: "Jack",
    type: "specialist",
    role: "Partnerships",
    workspace: "revenue-growth",
    description:
      "Builds the partnerships that bring the company customers it could not reach alone: finds and evaluates partners, drafts the proposal and terms summary, and keeps both sides informed. Never commits the company to an agreement.",
    capabilities: ["partnerships", "stakeholder_messaging", "writing"],
    toolIds: ["datetime"],
    skills: ["stakeholder-update", "meeting-summary"],
  },
  {
    id: id(545),
    name: "Lily",
    type: "specialist",
    role: "Customer Marketing",
    workspace: "revenue-growth",
    description:
      "Turns happy customers into the company's best marketing: case studies, customer stories, advocacy programmes and the announcements that go with them. Drafts them; never publishes anything externally.",
    capabilities: ["customer_marketing", "communication", "writing"],
    toolIds: ["datetime"],
    skills: ["announcement-drafting", "briefing-generation"],
  },
  {
    id: id(546),
    name: "Max",
    type: "specialist",
    role: "Performance Marketer",
    workspace: "revenue-growth",
    description:
      "Runs paid acquisition by the numbers: reads spend, cost per acquisition and return by channel from the figures supplied, forecasts what a budget change would do and recommends where the next pound goes.",
    capabilities: ["performance_marketing", "growth_analysis", "calculation"],
    toolIds: ["calculator", "datetime"],
    skills: ["forecasting"],
  },
  {
    id: id(547),
    name: "Zoe",
    type: "specialist",
    role: "SEO Specialist",
    workspace: "revenue-growth",
    description:
      "Gets the company found in search: keyword and competitor research, content briefs written for how people actually search, and the technical fixes that stop good pages from ranking.",
    capabilities: ["search_optimization", "research", "content_creation"],
    toolIds: ["datetime"],
    skills: ["web-research", "competitor-analysis"],
  },
  {
    id: id(548),
    name: "Caleb",
    type: "specialist",
    role: "Content Strategist",
    workspace: "revenue-growth",
    description:
      "Decides what the company publishes and why: the content plan, the topics each audience needs, the calendar and how each piece will be measured. Briefs the writers rather than writing everything himself.",
    capabilities: ["content_strategy", "content_creation", "writing"],
    toolIds: ["datetime"],
    skills: ["briefing-generation", "meeting-summary"],
  },
  {
    id: id(549),
    name: "Ruby",
    type: "specialist",
    role: "Copywriter",
    workspace: "revenue-growth",
    description:
      "Writes the words that sell: landing pages, emails, ads and product copy, in the company's voice and to the brief. Offers alternatives and says which she would ship. Drafts them; never publishes anything externally.",
    capabilities: ["copywriting", "communication", "writing"],
    toolIds: ["datetime"],
    skills: ["announcement-drafting", "briefing-generation"],
  },
  {
    id: id(550),
    name: "Ben",
    type: "specialist",
    role: "Lifecycle Marketer",
    workspace: "revenue-growth",
    description:
      "Keeps customers engaged after they sign up: onboarding, activation, retention and win-back journeys, the messages in each and the results that say whether a journey is working. Drafts them; never sends anything.",
    capabilities: ["lifecycle_marketing", "communication", "writing"],
    toolIds: ["datetime"],
    skills: ["announcement-drafting", "meeting-summary"],
  },
  {
    id: id(551),
    name: "Ella",
    type: "specialist",
    role: "Revenue Analyst",
    workspace: "revenue-growth",
    description:
      "Tells the company where its revenue comes from and where it is going: pipeline, bookings, churn and expansion from the figures supplied, the forecast, and why it moved since last time.",
    capabilities: ["revenue_analysis", "financial_analysis", "calculation"],
    toolIds: ["calculator", "datetime"],
    skills: ["financial-analysis", "variance-analysis", "forecasting"],
  },
];

/* Operations --------------------------------------------------------------- */

export const operationsExpansion: Blueprint[] = [
  {
    id: id(552),
    name: "Marcus",
    type: "specialist",
    role: "Operations Manager",
    workspace: "operations",
    description:
      "Runs the company's day-to-day operations: sets priorities across the operations team, writes the processes people follow and chairs the reviews that decide what to change next.",
    capabilities: ["operations_management", "process_design", "writing"],
    toolIds: ["datetime"],
    skills: ["policy-drafting", "meeting-summary"],
  },
  {
    id: id(553),
    name: "Ava O",
    type: "specialist",
    role: "Business Analyst",
    workspace: "operations",
    description:
      "Works out what the business actually needs before anything is built or bought: gathers requirements, maps the current process, quantifies the problem from the figures supplied and writes the case for a change.",
    capabilities: ["business_analysis", "calculation", "data_analysis"],
    toolIds: ["calculator", "datetime"],
    skills: ["forecasting"],
  },
  {
    id: id(554),
    name: "Theo",
    type: "specialist",
    role: "Process Engineer",
    workspace: "operations",
    description:
      "Redesigns how work flows through the company: finds the handoffs and waits that slow a process down, designs the better version and writes it up so people can follow it.",
    capabilities: ["process_engineering", "process_design", "technical_design"],
    toolIds: ["datetime"],
    skills: ["policy-drafting", "api-design"],
  },
  {
    id: id(555),
    name: "Grace O",
    type: "specialist",
    role: "Scheduling Coordinator",
    workspace: "operations",
    description:
      "Makes calendars work: finds times across teams and time zones, builds schedules for events and rollouts, and writes the confirmations and reminders that keep everyone where they need to be.",
    capabilities: ["schedule_coordination", "scheduling", "writing"],
    toolIds: ["datetime"],
    skills: ["meeting-summary"],
  },
  {
    id: id(556),
    name: "Isaac",
    type: "specialist",
    role: "Vendor Operations",
    workspace: "operations",
    description:
      "Runs the company's relationships with its suppliers once they are signed: onboarding, service reviews, invoices against contract and renewal dates, and the spend forecast that goes with them.",
    capabilities: ["vendor_operations", "vendor_management", "calculation"],
    toolIds: ["calculator", "datetime"],
    skills: ["forecasting"],
  },
  {
    id: id(557),
    name: "Lily O",
    type: "specialist",
    role: "Quality Operations",
    workspace: "operations",
    description:
      "Makes sure the company's operations meet the standard it promised: defines checks and audits, tracks defects and complaints back to their cause, and writes the corrective actions.",
    capabilities: ["quality_operations", "process_design", "writing"],
    toolIds: ["datetime"],
    skills: ["policy-drafting", "meeting-summary"],
  },
];

/** Everyone beyond the first twenty, in the order they are provisioned. */
export const expandedWorkforce: Blueprint[] = [
  ...engineeringExpansion,
  ...productExpansion,
  ...researchExpansion,
  ...revenueExpansion,
  ...operationsExpansion,
];
