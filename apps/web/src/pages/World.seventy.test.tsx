import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorldAgent, WorldSnapshot } from "../lib/api";
import { AccessContext } from "../lib/access";
import { castOf } from "../world/sprites";

import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import World from "./World";

/**
 * The office at full size: seventy-one agents in nine rooms, with the ids,
 * rooms, roles and capabilities the company has - the seed's sixty-nine
 * blueprints, Tony, Harvey and Mike where a person moved them, and Dana and
 * Rhea as people made them. The page reads whatever the snapshot holds; this
 * is the size it has to hold up at.
 */

const room = {
  hall: "hall",
  engineering: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",
  product: "e32813a2-dda6-4a89-a756-c2991510d002",
  research: "54c504b8-442d-47db-8c36-211dc09134ac",
  revenue: "e32813a2-dda6-4a89-a756-c2991510d004",
  operations: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",
  customers: "4458cec5-123f-4b08-b167-34e7316eb7de",
  compliance: "e32813a2-dda6-4a89-a756-c2991510d007",
  finance: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",
};

const roomNames: Record<string, string> = {
  [room.hall]: "Company hall",
  [room.engineering]: "Engineering",
  [room.product]: "Product",
  [room.research]: "Research",
  [room.revenue]: "Revenue & Growth",
  [room.operations]: "Operations",
  [room.customers]: "Customer Success",
  [room.compliance]: "Compliance & Risk",
  [room.finance]: "Finance",
};

const people: Array<{ id: string; name: string; room: string; capabilities: string[]; role?: string; type?: WorldAgent["type"] }> = [
  {id: "e32813a2-dda6-4a89-a756-c2991510c501",name: "Tyrion",room: "hall",capabilities: ["planning","coordination","decision_support"],type: "orchestrator"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c502",name: "Tony",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["coding","technical_design","data_transformation"]},
  {id: "e32813a2-dda6-4a89-a756-c2991510c503",name: "Harvey",room: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",capabilities: ["calculation","financial_analysis","decision_support"]},
  {id: "e32813a2-dda6-4a89-a756-c2991510c504",name: "Mike",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["research","synthesis","writing"]},
  {id: "e32813a2-dda6-4a89-a756-c2991510c505",name: "Jamie",room: "hall",capabilities: ["people_operations","process_design","writing"]},
  {id: "e32813a2-dda6-4a89-a756-c2991510c506",name: "Peter",room: "hall",capabilities: ["communication","stakeholder_messaging","writing"]},
  {id: "e32813a2-dda6-4a89-a756-c2991510c507",name: "Wanda",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["frontend_development","coding"],role: "Frontend Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c508",name: "Bruce",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["backend_development","coding","technical_design"],role: "Backend Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c509",name: "Natasha",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["quality_assurance","coding"],role: "QA Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c510",name: "Sam",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["infrastructure_operations","technical_design"],role: "DevOps Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c511",name: "Jessica",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["product_management","stakeholder_messaging","writing"],role: "Product Manager"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c512",name: "Rachel",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["product_research","research","synthesis"],role: "Product Researcher"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c513",name: "Donna",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["sales","stakeholder_messaging","writing"],role: "Account Executive"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c514",name: "Louis",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["marketing","communication","writing"],role: "Marketing Manager"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c515",name: "Sansa",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["content_creation","growth_analysis","writing"],role: "Growth & Content Lead"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c516",name: "Brienne",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["project_coordination","scheduling","writing"],role: "Project Coordinator"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c517",name: "Davos",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["procurement","vendor_management","calculation"],role: "Procurement & Vendor Manager"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c518",name: "Katrina",room: "4458cec5-123f-4b08-b167-34e7316eb7de",capabilities: ["customer_support","customer_communication","writing"],role: "Customer Support Specialist"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c519",name: "Alex",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["full_stack_development","frontend_development","backend_development","coding"],role: "Full-Stack Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c520",name: "Maya",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["machine_learning","coding","technical_design"],role: "ML Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c521",name: "Leo",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["ai_engineering","coding","technical_design"],role: "AI Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c522",name: "Elena",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["data_engineering","coding","technical_design"],role: "Data Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c523",name: "Ryan",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["mlops","infrastructure_operations","technical_design"],role: "MLOps Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c524",name: "Chloe",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["security_engineering","coding","technical_design"],role: "Security Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c525",name: "Ethan",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["platform_engineering","infrastructure_operations","technical_design"],role: "Platform Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c526",name: "Olivia",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["cloud_infrastructure","infrastructure_operations","technical_design"],role: "Cloud Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c527",name: "Noah",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["site_reliability","infrastructure_operations","technical_design"],role: "SRE"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c528",name: "Arjun",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["performance_engineering","coding","technical_design"],role: "Performance Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c529",name: "Sophie",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["mobile_development","coding"],role: "Mobile Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c530",name: "Liam",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["systems_integration","backend_development","technical_design"],role: "Integration Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c531",name: "Emma",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["product_strategy","stakeholder_messaging","writing"],role: "Product Strategist"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c532",name: "Lucas",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["product_design","user_experience","writing"],role: "Product Designer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c533",name: "Mia",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["ux_research","user_experience","research","synthesis"],role: "UX Researcher"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c534",name: "Daniel",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["product_analytics","calculation","data_analysis"],role: "Product Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c535",name: "Ava",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["product_operations","process_design","writing"],role: "Product Operations"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c536",name: "Henry",room: "e32813a2-dda6-4a89-a756-c2991510d002",capabilities: ["technical_product_management","technical_design","stakeholder_messaging"],role: "Technical Product Manager"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c537",name: "Nora",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["competitive_intelligence","research","synthesis"],role: "Competitive Intelligence"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c538",name: "Adam",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["technical_research","research","synthesis"],role: "Technical Researcher"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c539",name: "Isabella",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["market_analysis","research","calculation"],role: "Market Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c540",name: "Ethan R",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["data_research","research","data_analysis"],role: "Data Researcher"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c541",name: "Clara",room: "54c504b8-442d-47db-8c36-211dc09134ac",capabilities: ["knowledge_management","synthesis","writing"],role: "Knowledge Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c542",name: "Ryan R",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["sales_development","prospecting","writing"],role: "Sales Development"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c543",name: "Grace",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["account_management","sales","stakeholder_messaging","writing"],role: "Account Executive"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c544",name: "Jack",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["partnerships","stakeholder_messaging","writing"],role: "Partnerships"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c545",name: "Lily",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["customer_marketing","communication","writing"],role: "Customer Marketing"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c546",name: "Max",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["performance_marketing","growth_analysis","calculation"],role: "Performance Marketer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c547",name: "Zoe",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["search_optimization","research","content_creation"],role: "SEO Specialist"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c548",name: "Caleb",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["content_strategy","content_creation","writing"],role: "Content Strategist"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c549",name: "Ruby",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["copywriting","communication","writing"],role: "Copywriter"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c550",name: "Ben",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["lifecycle_marketing","communication","writing"],role: "Lifecycle Marketer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c551",name: "Ella",room: "e32813a2-dda6-4a89-a756-c2991510d004",capabilities: ["revenue_analysis","financial_analysis","calculation"],role: "Revenue Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c552",name: "Marcus",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["operations_management","process_design","writing"],role: "Operations Manager"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c553",name: "Ava O",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["business_analysis","calculation","data_analysis"],role: "Business Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c554",name: "Theo",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["process_engineering","process_design","technical_design"],role: "Process Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c555",name: "Grace O",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["schedule_coordination","scheduling","writing"],role: "Scheduling Coordinator"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c556",name: "Isaac",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["vendor_operations","vendor_management","calculation"],role: "Vendor Operations"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c557",name: "Lily O",room: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",capabilities: ["quality_operations","process_design","writing"],role: "Quality Operations"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c558",name: "Olivia F",room: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",capabilities: ["investment_analysis","financial_analysis","calculation"],role: "Financial Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c559",name: "James",room: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",capabilities: ["accounting","bookkeeping","calculation"],role: "Accounts Specialist"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c560",name: "Sophia",room: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",capabilities: ["financial_planning","financial_analysis","calculation"],role: "FP&A Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c561",name: "William",room: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",capabilities: ["finance_operations","process_design","calculation"],role: "Finance Operations"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c562",name: "Amelia",room: "4458cec5-123f-4b08-b167-34e7316eb7de",capabilities: ["customer_success","stakeholder_messaging","writing"],role: "Customer Success Manager"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c563",name: "Mason",room: "4458cec5-123f-4b08-b167-34e7316eb7de",capabilities: ["customer_onboarding","customer_communication","writing"],role: "Onboarding Specialist"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c564",name: "Harper",room: "4458cec5-123f-4b08-b167-34e7316eb7de",capabilities: ["technical_support","coding","customer_communication"],role: "Support Engineer"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c565",name: "Evelyn",room: "4458cec5-123f-4b08-b167-34e7316eb7de",capabilities: ["customer_insights","research","synthesis"],role: "Customer Insights"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c566",name: "Victor",room: "hall",capabilities: ["executive_analysis","decision_support","communication"],role: "Executive Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c567",name: "Stella",room: "hall",capabilities: ["strategy_analysis","research","decision_support"],role: "Strategy Analyst"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c568",name: "Adrian",room: "hall",capabilities: ["executive_coordination","communication","stakeholder_messaging"],role: "Chief of Staff"},
  {id: "e32813a2-dda6-4a89-a756-c2991510c569",name: "Victoria",room: "e32813a2-dda6-4a89-a756-c2991510d007",capabilities: ["compliance","risk_assessment","process_design"],role: "Compliance Analyst"},
  {id: "295bf325-f292-49bc-bb99-fc7a43394e09",name: "Dana",room: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",capabilities: ["scheduling","calculation"]},
  {id: "7e9b865a-4743-49a5-b1af-b4f0ff7bc9b7",name: "Rhea",room: "4458cec5-123f-4b08-b167-34e7316eb7de",capabilities: ["customer_communication","writing"]},
];

function office(): WorldSnapshot {
  const seats = new Map<string, number>();

  return {
    organizationId: "org",
    generatedAt: new Date().toISOString(),
    rooms: Object.entries(roomNames).map(([id, name]) => ({
      id,
      kind: id === room.hall ? "hall" : "workspace",
      name,
      ...(id === room.hall ? {} : { slug: name.toLowerCase().replace(/[^a-z]+/g, "-") }),
      agentIds: people.filter((person) => person.room === id).map((person) => person.id),
    })),
    agents: people.map((person): WorldAgent => {
      const seat = seats.get(person.room) ?? 0;
      seats.set(person.room, seat + 1);
      return {
        id: person.id,
        name: person.name,
        ...(person.role ? { role: person.role } : {}),
        type: person.type ?? "specialist",
        status: "active",
        presence: "available",
        capabilities: person.capabilities,
        roomId: person.room,
        seat,
        workingElsewhere: false,
        upcomingSteps: 0,
        planningElsewhere: false,
      };
    }),
    missions: [],
    handoffs: [],
  };
}

function open() {
  stubNetwork((call) => {
    if (call.url.pathname.endsWith("/world")) return json(200, office());
    if (/\/workforce\/[^/]+$/.test(call.url.pathname)) {
      return json(200, {
        governance: { tools: [{ toolId: "datetime", name: "Date/Time", access: "allowed", risk: "low", policyNames: [], explanation: "" }], policies: [] },
        skills: [{ slug: "meeting-summary", name: "Meeting summary", category: null, scope: null, approval: null, usable: true, note: "" }],
      });
    }
    return json(404, { error: { message: "Not here." } });
  });

  const router = createMemoryRouter(
    [{ path: "/world", element: <AccessContext.Provider value={signedInAs("owner")}><World /></AccessContext.Provider> }],
    { initialEntries: ["/world"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("the world with all seventy-one", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("draws one desk for every agent, in their room, and counts them", async () => {
    expect(people).toHaveLength(71);
    expect(new Set(people.map((person) => person.id)).size).toBe(71);

    const { container } = open();
    await waitFor(() => expect(container.querySelectorAll(".world-desk")).toHaveLength(71));

    expect(screen.getByText(/71 agents in 9 rooms/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Everyone 71" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Engineering. 18 agents." })).toBeDefined();
    expect(screen.getByRole("button", { name: "Revenue & Growth. 13 agents." })).toBeDefined();
    expect(screen.getByRole("button", { name: "Compliance & Risk. 1 agent." })).toBeDefined();
    expect(screen.getByRole("button", { name: "Company hall. 6 agents." })).toBeDefined();
  });

  it("draws no two roommates of one discipline alike, however full the room", () => {
    const snapshot = office();
    const cast = castOf(snapshot.agents);

    for (const placed of snapshot.rooms) {
      const looks = placed.agentIds.map((id) => {
        const look = cast.get(id)!;
        return `${look.discipline}/${look.hair}/${look.haircut}`;
      });
      expect(new Set(looks).size, placed.name).toBe(looks.length);
    }
  });

  it("finds the newcomers and their rooms", async () => {
    open();
    const search = await screen.findByRole("searchbox", { name: "Find in the office" });

    for (const name of ["Ethan R", "Victoria", "Olivia F", "Adrian"]) {
      await userEvent.clear(search);
      await userEvent.type(search, name);
      const hits = within(screen.getByRole("list", { name: "Matches" })).getAllByRole("button").map((hit) => hit.textContent);
      expect(hits.some((hit) => hit?.startsWith(`Agent ${name}`)), `${name}: ${JSON.stringify(hits)}`).toBe(true);
    }

    await userEvent.clear(search);
    await userEvent.type(search, "compliance");
    expect(within(screen.getByRole("list", { name: "Matches" })).getAllByRole("button")[0]!.textContent).toMatch(/^Room Compliance & Risk/);
  });

  it("shows a newcomer's role and room in their details", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "List" }));

    for (const person of people.filter((entry) => ["Victoria", "Olivia F", "Adrian", "Alex"].includes(entry.name))) {
      await userEvent.click(screen.getByRole("button", { name: person.name }));
      const details = screen.getByRole("complementary", { name: `Details: ${person.name}` });

      expect(within(details).getByText(person.role!), person.name).toBeDefined();
      expect(within(details).getByText(roomNames[person.room]!), person.name).toBeDefined();
    }
  });
});
