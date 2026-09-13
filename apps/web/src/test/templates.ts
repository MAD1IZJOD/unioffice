import type { MissionTemplateView } from "../lib/api";

/** The shape GET /mission-templates returns, with the fields a page reads. */
export function financialReview(
  overrides: Partial<MissionTemplateView> = {},
): MissionTemplateView {
  return {
    template: {
      id: "prepare-a-financial-review",
      version: 1,
      name: "Prepare a Financial Review",
      purpose: "Look hard at the numbers before a decision is made on them.",
      outcome: "A review with the figures checked",
      capabilities: ["financial_analysis", "calculation"],
      complexity: "focused",
      objective: {
        label: "What the review should answer",
        placeholder: "Are we on track against the quarter's budget?",
        hint: "The question the numbers need to settle.",
      },
      context: {
        label: "Figures and background",
        placeholder: "Salaries, cloud, lease...",
        hint: "Whatever the reviewer cannot look up.",
      },
      desiredOutcome: {
        label: "What should exist at the end",
        placeholder: "A one-page summary.",
        hint: "The thing you will read.",
      },
      constraints: {
        label: "Rules it must keep to",
        placeholder: "Use only these figures.",
        hint: "Treated as binding.",
      },
      planningGuidance: "Check the arithmetic before interpreting it.",
    },
    likelyTeam: [
      {
        agentId: "aaaaaaaa-0000-0000-0000-000000000002",
        name: "Harvey",
        type: "specialist",
        matchedCapabilities: ["financial_analysis", "calculation"],
      },
    ],
    planner: {
      agentId: "aaaaaaaa-0000-0000-0000-000000000001",
      name: "Tyrion",
      type: "orchestrator",
      matchedCapabilities: [],
    },
    governance: {
      gatingPolicies: [
        { id: "policy-1", name: "Finance sign-off", effect: "require_approval" },
      ],
    },
    ...overrides,
  };
}
