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

// The fifty-one of the expansion, with the capabilities they are provisioned with.
const expansion = [
  { name: "Alex", capabilities: ["full_stack_development","frontend_development","backend_development","coding"], is: "engineering" },
  { name: "Maya", capabilities: ["machine_learning","coding","technical_design"], is: "engineering" },
  { name: "Leo", capabilities: ["ai_engineering","coding","technical_design"], is: "engineering" },
  { name: "Elena", capabilities: ["data_engineering","coding","technical_design"], is: "engineering" },
  { name: "Ryan", capabilities: ["mlops","infrastructure_operations","technical_design"], is: "engineering" },
  { name: "Chloe", capabilities: ["security_engineering","coding","technical_design"], is: "engineering" },
  { name: "Ethan", capabilities: ["platform_engineering","infrastructure_operations","technical_design"], is: "engineering" },
  { name: "Olivia", capabilities: ["cloud_infrastructure","infrastructure_operations","technical_design"], is: "engineering" },
  { name: "Noah", capabilities: ["site_reliability","infrastructure_operations","technical_design"], is: "engineering" },
  { name: "Arjun", capabilities: ["performance_engineering","coding","technical_design"], is: "engineering" },
  { name: "Sophie", capabilities: ["mobile_development","coding"], is: "engineering" },
  { name: "Liam", capabilities: ["systems_integration","backend_development","technical_design"], is: "engineering" },
  { name: "Emma", capabilities: ["product_strategy","stakeholder_messaging","writing"], is: "communication" },
  { name: "Lucas", capabilities: ["product_design","user_experience","writing"], is: "research" },
  { name: "Mia", capabilities: ["ux_research","user_experience","research","synthesis"], is: "research" },
  { name: "Daniel", capabilities: ["product_analytics","calculation","data_analysis"], is: "quantitative" },
  { name: "Ava", capabilities: ["product_operations","process_design","writing"], is: "operations" },
  { name: "Henry", capabilities: ["technical_product_management","technical_design","stakeholder_messaging"], is: "engineering" },
  { name: "Nora", capabilities: ["competitive_intelligence","research","synthesis"], is: "research" },
  { name: "Adam", capabilities: ["technical_research","research","synthesis"], is: "research" },
  { name: "Isabella", capabilities: ["market_analysis","research","calculation"], is: "quantitative" },
  { name: "Ethan R", capabilities: ["data_research","research","data_analysis"], is: "research" },
  { name: "Clara", capabilities: ["knowledge_management","synthesis","writing"], is: "research" },
  { name: "Ryan R", capabilities: ["sales_development","prospecting","writing"], is: "communication" },
  { name: "Grace", capabilities: ["account_management","sales","stakeholder_messaging","writing"], is: "communication" },
  { name: "Jack", capabilities: ["partnerships","stakeholder_messaging","writing"], is: "communication" },
  { name: "Lily", capabilities: ["customer_marketing","communication","writing"], is: "communication" },
  { name: "Max", capabilities: ["performance_marketing","growth_analysis","calculation"], is: "quantitative" },
  { name: "Zoe", capabilities: ["search_optimization","research","content_creation"], is: "research" },
  { name: "Caleb", capabilities: ["content_strategy","content_creation","writing"], is: "communication" },
  { name: "Ruby", capabilities: ["copywriting","communication","writing"], is: "communication" },
  { name: "Ben", capabilities: ["lifecycle_marketing","communication","writing"], is: "communication" },
  { name: "Ella", capabilities: ["revenue_analysis","financial_analysis","calculation"], is: "quantitative" },
  { name: "Marcus", capabilities: ["operations_management","process_design","writing"], is: "operations" },
  { name: "Ava O", capabilities: ["business_analysis","calculation","data_analysis"], is: "quantitative" },
  { name: "Theo", capabilities: ["process_engineering","process_design","technical_design"], is: "operations" },
  { name: "Grace O", capabilities: ["schedule_coordination","scheduling","writing"], is: "operations" },
  { name: "Isaac", capabilities: ["vendor_operations","vendor_management","calculation"], is: "operations" },
  { name: "Lily O", capabilities: ["quality_operations","process_design","writing"], is: "operations" },
  { name: "Olivia F", capabilities: ["investment_analysis","financial_analysis","calculation"], is: "quantitative" },
  { name: "James", capabilities: ["accounting","bookkeeping","calculation"], is: "quantitative" },
  { name: "Sophia", capabilities: ["financial_planning","financial_analysis","calculation"], is: "quantitative" },
  { name: "William", capabilities: ["finance_operations","process_design","calculation"], is: "operations" },
  { name: "Amelia", capabilities: ["customer_success","stakeholder_messaging","writing"], is: "communication" },
  { name: "Mason", capabilities: ["customer_onboarding","customer_communication","writing"], is: "communication" },
  { name: "Harper", capabilities: ["technical_support","coding","customer_communication"], is: "engineering" },
  { name: "Evelyn", capabilities: ["customer_insights","research","synthesis"], is: "research" },
  { name: "Victor", capabilities: ["executive_analysis","decision_support","communication"], is: "communication" },
  { name: "Stella", capabilities: ["strategy_analysis","research","decision_support"], is: "research" },
  { name: "Adrian", capabilities: ["executive_coordination","communication","stakeholder_messaging"], is: "communication" },
  { name: "Victoria", capabilities: ["compliance","risk_assessment","process_design"], is: "operations" },
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

  it("reads each of the expansion by the work they were given, never as a generic specialist", () => {
    expect(expansion).toHaveLength(51);
    for (const agent of expansion) {
      const discipline = disciplineOf({ type: "specialist", capabilities: [...agent.capabilities] });
      expect(discipline, agent.name).toBe(agent.is);
      expect(discipline, agent.name).not.toBe("general");
    }
  });

  it("reads each of the twelve by the work they were given, never as a generic specialist", () => {
    for (const agent of twelve) {
      const discipline = disciplineOf({ type: "specialist", capabilities: [...agent.capabilities] });
      expect(discipline, agent.name).toBe(agent.is);
      expect(discipline, agent.name).not.toBe("general");
    }
  });
});
