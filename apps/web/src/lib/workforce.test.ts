import { describe, expect, it } from "vitest";

import { disciplineOf, roleLabel } from "./workforce";

/**
 * Who reads as what. Each agent is described by the capabilities it was
 * actually given - the same ones the delegator routes on - so an engineer
 * looks like one because it can build, not because of its name.
 */

// The first eight, as the company runs them today.
const firstEight = [
  { name: "Tyrion", type: "orchestrator", capabilities: ["planning", "coordination", "decision_support"], is: "orchestration" },
  { name: "Tony", type: "specialist", capabilities: ["coding", "technical_design", "data_transformation"], is: "engineering" },
  { name: "Harvey", type: "specialist", capabilities: ["calculation", "financial_analysis", "decision_support"], is: "quantitative" },
  { name: "Mike", type: "specialist", capabilities: ["research", "synthesis", "writing"], is: "research" },
  { name: "Jamie", type: "specialist", capabilities: ["people_operations", "process_design", "writing"], is: "operations" },
  { name: "Peter", type: "specialist", capabilities: ["communication", "stakeholder_messaging", "writing"], is: "communication" },
  { name: "Dana", type: "specialist", capabilities: ["scheduling", "calculation"], is: "quantitative" },
  { name: "Rhea", type: "specialist", capabilities: ["customer_communication", "writing"], is: "general" },
] as const;

// The twelve beyond them, with the capabilities they are seeded with.
const twelve = [
  { name: "Wanda", capabilities: ["frontend_development", "coding"], is: "engineering" },
  { name: "Bruce", capabilities: ["backend_development", "coding", "technical_design"], is: "engineering" },
  { name: "Natasha", capabilities: ["quality_assurance", "coding"], is: "engineering" },
  { name: "Sam", capabilities: ["infrastructure_operations", "technical_design"], is: "engineering" },
  { name: "Jessica", capabilities: ["product_management", "stakeholder_messaging", "writing"], is: "communication" },
  { name: "Rachel", capabilities: ["product_research", "research", "synthesis"], is: "research" },
  { name: "Donna", capabilities: ["sales", "stakeholder_messaging", "writing"], is: "communication" },
  { name: "Louis", capabilities: ["marketing", "communication", "writing"], is: "communication" },
  { name: "Sansa", capabilities: ["content_creation", "growth_analysis", "writing"], is: "communication" },
  { name: "Brienne", capabilities: ["project_coordination", "scheduling", "writing"], is: "operations" },
  { name: "Davos", capabilities: ["procurement", "vendor_management", "calculation"], is: "operations" },
  { name: "Katrina", capabilities: ["customer_support", "customer_communication", "writing"], is: "communication" },
] as const;

describe("reading a discipline from what an agent can do", () => {
  it("reads the first eight exactly as before", () => {
    for (const agent of firstEight) {
      expect(disciplineOf({ type: agent.type, capabilities: [...agent.capabilities] }), agent.name).toBe(agent.is);
    }
  });

  it("calls an agent by the role they were given, and one given none by their discipline", () => {
    expect(roleLabel({ role: "Backend Engineer", type: "specialist", capabilities: ["backend_development"] })).toBe("Backend Engineer");
    expect(roleLabel({ role: "  ", type: "specialist", capabilities: ["coding"] })).toBe("Engineering");
    expect(roleLabel({ type: "orchestrator", capabilities: ["planning"] })).toBe("Orchestration");
  });

  it("reads each of the twelve by the work they were given, never as a generic specialist", () => {
    for (const agent of twelve) {
      const discipline = disciplineOf({ type: "specialist", capabilities: [...agent.capabilities] });
      expect(discipline, agent.name).toBe(agent.is);
      expect(discipline, agent.name).not.toBe("general");
    }
  });
});
