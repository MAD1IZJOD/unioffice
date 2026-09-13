/**
 * Mission templates.
 *
 * A template is a kind of objective the company runs again and again - a
 * launch, a financial review, a hiring process. It exists to get a mission
 * started well, not to run it: it collects the inputs that kind of mission
 * needs and turns them into a clear objective and a structured briefing. From
 * there the mission is ordinary work. The orchestrator writes the plan,
 * delegation routes it, governance decides what may run, and the queue
 * executes it - exactly as for a mission typed from scratch.
 *
 * Templates live here, in code, rather than in a table. There is no
 * user-authored template yet, and a template changes the way a mission is
 * briefed - which is something that should be reviewed like code and
 * versioned with it.
 *
 * What a template deliberately cannot do: name agents, grant tools or
 * capabilities, pre-write tasks, or say anything about approvals. The
 * capabilities listed below are only used to show who is likely to take part;
 * they are never handed to the planner or the delegator.
 */

export type TemplateComplexity = "focused" | "cross_functional" | "broad";

export interface MissionTemplateField {
  /** What the person is asked, in their terms. */
  label: string;
  placeholder: string;
  /** Shown under the field. */
  hint: string;
}

export interface MissionTemplate {
  /** Stable slug. Part of the URL and recorded on every mission it starts. */
  id: string;

  /** Bumped whenever the briefing a template produces changes meaning. */
  version: number;

  name: string;

  /** One or two sentences: what running this mission achieves. */
  purpose: string;

  /** The kind of result it usually leaves behind. */
  outcome: string;

  /**
   * The disciplines this kind of mission usually draws on. Used only to find
   * the agents on the real roster likely to take part - never to route work.
   */
  capabilities: string[];

  complexity: TemplateComplexity;

  objective: MissionTemplateField;

  context: MissionTemplateField;

  desiredOutcome: MissionTemplateField;

  constraints: MissionTemplateField;

  /**
   * What this kind of mission usually has to cover, written for the planner.
   * It informs the plan; the orchestrator still decides what the tasks are.
   */
  planningGuidance: string;
}

export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  {
    id: "launch-a-product",
    version: 1,
    name: "Launch a Product",
    purpose:
      "Turn a product idea into an execution plan, the technical work behind it, launch materials and a coordinated set of deliverables.",
    outcome: "A launch plan, technical scope and launch messaging",
    capabilities: ["technical_design", "coding", "research", "communication", "stakeholder_messaging"],
    complexity: "broad",
    objective: {
      label: "What are you launching?",
      placeholder: "Launch the team plan for our scheduling product.",
      hint: "One sentence naming the product and the launch.",
    },
    context: {
      label: "What does the company already know?",
      placeholder: "Who it is for, what exists today, pricing, the audience, prior attempts.",
      hint: "Read at planning time, so it shapes the tasks that get written.",
    },
    desiredOutcome: {
      label: "What should exist when this is done?",
      placeholder: "A launch plan with milestones, the technical scope, and announcement copy.",
      hint: "The deliverables you expect to be able to open afterwards.",
    },
    constraints: {
      label: "Anything it must respect?",
      placeholder: "Budget, launch window, channels to avoid, regulatory limits.",
      hint: "Optional. Treated as binding by the planner.",
    },
    planningGuidance:
      "A product launch usually needs: the launch scope and success measures, the technical work required and its risks, the target audience and positioning, launch messaging for customers and stakeholders, and a sequenced plan that ties these together.",
  },
  {
    id: "research-a-market",
    version: 1,
    name: "Research a Market",
    purpose:
      "Understand a market before committing to it: who is in it, what they pay, where the gaps are and what that means for the company.",
    outcome: "A market brief with sizing, competitors and a recommendation",
    capabilities: ["research", "synthesis", "writing", "financial_analysis"],
    complexity: "cross_functional",
    objective: {
      label: "Which market, and why now?",
      placeholder: "Assess the market for AI scheduling tools for mid-size clinics.",
      hint: "Name the market and the decision the research should inform.",
    },
    context: {
      label: "What is already known?",
      placeholder: "Competitors you know of, figures you have, customer conversations.",
      hint: "Figures given here are used as-is rather than estimated.",
    },
    desiredOutcome: {
      label: "What decision should this support?",
      placeholder: "Whether to enter the market this year, and at what price point.",
      hint: "The brief is written towards this.",
    },
    constraints: {
      label: "Anything to stay within?",
      placeholder: "Regions, segments, sources to exclude.",
      hint: "Optional.",
    },
    planningGuidance:
      "Market research usually needs: a definition of the market and segment, the main competitors and their positioning and pricing, an estimate of market size built from stated figures, the gaps or unmet needs, and a recommendation tied to the decision it supports.",
  },
  {
    id: "prepare-a-financial-review",
    version: 1,
    name: "Prepare a Financial Review",
    purpose:
      "Work through the numbers for a period or a decision - costs, revenue, runway - with calculations done exactly rather than estimated.",
    outcome: "A financial review with calculated figures and implications",
    capabilities: ["financial_analysis", "calculation", "decision_support"],
    complexity: "focused",
    objective: {
      label: "What should be reviewed?",
      placeholder: "Review Q3 operating costs against revenue and projected runway.",
      hint: "The period, the figures and the question.",
    },
    context: {
      label: "The figures",
      placeholder: "Salaries 48,200/month, cloud 9,350, lease 12,500; revenue 61,000; cash 900,000.",
      hint: "Give the real numbers. Calculations use the calculator tool, not guesses.",
    },
    desiredOutcome: {
      label: "What do you need to know at the end?",
      placeholder: "Monthly burn, months of runway, and which costs matter most.",
      hint: "The review answers these directly.",
    },
    constraints: {
      label: "Assumptions to hold fixed?",
      placeholder: "Assume no new hires; exclude one-off legal costs.",
      hint: "Optional.",
    },
    planningGuidance:
      "A financial review usually needs: every figure calculated exactly from the numbers supplied, the key totals and ratios, a comparison against the stated period or target, and the implications for the decision in plain language.",
  },
  {
    id: "run-a-hiring-process",
    version: 1,
    name: "Run a Hiring Process",
    purpose:
      "Set up a hire properly: what the role is, how candidates are assessed and how the process runs from first contact to offer.",
    outcome: "A role definition, interview process and candidate communications",
    capabilities: ["people_operations", "process_design", "communication", "writing"],
    complexity: "cross_functional",
    objective: {
      label: "Which role are you hiring for?",
      placeholder: "Hire a senior backend engineer for the platform team.",
      hint: "The role and the team it joins.",
    },
    context: {
      label: "What should the process know?",
      placeholder: "Why the role exists, the team, level, location, salary band.",
      hint: "Read at planning time.",
    },
    desiredOutcome: {
      label: "What should be ready to use?",
      placeholder: "A job description, interview stages with scorecards, and outreach templates.",
      hint: "The documents the hiring manager will actually use.",
    },
    constraints: {
      label: "Anything it must respect?",
      placeholder: "Hiring timeline, interview panel availability, legal requirements.",
      hint: "Optional. Nothing is sent to candidates - drafts only.",
    },
    planningGuidance:
      "A hiring process usually needs: the role's responsibilities and must-have criteria, the interview stages and what each assesses, fair scoring guidance, and candidate-facing communications drafted for review. Nothing is sent externally.",
  },
  {
    id: "prepare-a-stakeholder-update",
    version: 1,
    name: "Prepare a Stakeholder Update",
    purpose:
      "Turn what the company has done into a clear update for investors, leadership or customers - what happened, what it means and what comes next.",
    outcome: "A stakeholder update drafted for review",
    capabilities: ["communication", "stakeholder_messaging", "writing", "synthesis"],
    complexity: "focused",
    objective: {
      label: "Who is the update for, and about what?",
      placeholder: "Write the monthly investor update for August.",
      hint: "The audience and the period or subject.",
    },
    context: {
      label: "What happened?",
      placeholder: "Milestones, numbers, problems, decisions made this period.",
      hint: "The update is written from this, so include what matters.",
    },
    desiredOutcome: {
      label: "What should the reader take away?",
      placeholder: "Confidence in the launch timeline and a clear ask for introductions.",
      hint: "The update is shaped towards this.",
    },
    constraints: {
      label: "Tone, length or things to avoid?",
      placeholder: "Under 400 words; do not mention the unannounced partnership.",
      hint: "Optional. Drafted only - nothing is sent.",
    },
    planningGuidance:
      "A stakeholder update usually needs: the key developments and figures for the period, an honest account of problems and how they are being handled, what comes next, and any ask - written for the named audience and drafted for review, never sent.",
  },
  {
    id: "investigate-a-business-problem",
    version: 1,
    name: "Investigate a Business Problem",
    purpose:
      "Get to the bottom of something that is going wrong - falling conversion, rising churn, a stalled process - and come back with causes and options.",
    outcome: "A diagnosis with likely causes and recommended options",
    capabilities: ["research", "decision_support", "data_transformation", "synthesis"],
    complexity: "cross_functional",
    objective: {
      label: "What is going wrong?",
      placeholder: "Find out why trial-to-paid conversion dropped in August.",
      hint: "The symptom, as specifically as you can state it.",
    },
    context: {
      label: "What do you know so far?",
      placeholder: "When it started, the numbers, recent changes, what has been ruled out.",
      hint: "Data given here is analysed directly.",
    },
    desiredOutcome: {
      label: "What would a good answer look like?",
      placeholder: "The two or three most likely causes and what to try first.",
      hint: "The investigation works towards this.",
    },
    constraints: {
      label: "Anything out of bounds?",
      placeholder: "Don't propose pricing changes; focus on onboarding.",
      hint: "Optional.",
    },
    planningGuidance:
      "An investigation usually needs: a precise statement of the problem and when it began, analysis of the data provided, the candidate causes weighed against that evidence, and a short list of options with the first thing to try.",
  },
];

export function findMissionTemplate(id: string): MissionTemplate | undefined {
  return MISSION_TEMPLATES.find((template) => template.id === id);
}
