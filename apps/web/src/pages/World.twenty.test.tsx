import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { WorldAgent, WorldSnapshot } from "../lib/api";
import { AccessContext } from "../lib/access";
import { disciplineOf } from "../lib/workforce";
import { lookOf } from "../world/sprites";

import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import World from "./World";

/**
 * The office with twenty: the eight the company has, and the twelve
 * proposed in the seed (`proposedWorkforce`), with the ids, rooms, roles and
 * capabilities they would be provisioned with. Their names are proposals and
 * not final; nothing here depends on them - the page is expected to handle
 * twenty because it reads the snapshot, whatever is in it, and a renamed
 * agent would change only this fixture. Looks are drawn from ids, which is
 * why the real ones are used.
 */

const room = {
  hall: "hall",
  customers: "4458cec5-123f-4b08-b167-34e7316eb7de",
  engineering: "ee52c29c-e9b5-47d6-8e11-666c05088a4c",
  finance: "a4d57028-90bc-4c1e-acaf-0cddb13465bf",
  operations: "ea4d5f57-e0c4-453e-899a-b0aacb34d3ef",
  product: "e32813a2-dda6-4a89-a756-c2991510d002",
  research: "54c504b8-442d-47db-8c36-211dc09134ac",
  revenue: "e32813a2-dda6-4a89-a756-c2991510d004",
};

const seed = (n: number) => `e32813a2-dda6-4a89-a756-c2991510c5${String(n).padStart(2, "0")}`;

const people: Array<{ id: string; name: string; room: string; capabilities: string[]; role?: string; type?: WorldAgent["type"] }> = [
  { id: seed(1), name: "Tyrion", room: room.hall, capabilities: ["planning", "coordination", "decision_support"], type: "orchestrator" },
  { id: seed(5), name: "Jamie", room: room.hall, capabilities: ["people_operations", "process_design", "writing"] },
  { id: seed(6), name: "Peter", room: room.hall, capabilities: ["communication", "stakeholder_messaging", "writing"] },
  { id: "7e9b865a-4743-49a5-b1af-b4f0ff7bc9b7", name: "Rhea", room: room.customers, capabilities: ["customer_communication", "writing"] },
  { id: seed(18), name: "Katrina", room: room.customers, role: "Customer Support Specialist", capabilities: ["customer_support", "customer_communication", "writing"] },
  { id: "295bf325-f292-49bc-bb99-fc7a43394e09", name: "Dana", room: room.engineering, capabilities: ["scheduling", "calculation"] },
  { id: seed(2), name: "Tony", room: room.engineering, capabilities: ["coding", "technical_design", "data_transformation"] },
  { id: seed(7), name: "Wanda", room: room.engineering, role: "Frontend Engineer", capabilities: ["frontend_development", "coding"] },
  { id: seed(8), name: "Bruce", room: room.engineering, role: "Backend Engineer", capabilities: ["backend_development", "coding", "technical_design"] },
  { id: seed(9), name: "Natasha", room: room.engineering, role: "QA Engineer", capabilities: ["quality_assurance", "coding"] },
  { id: seed(10), name: "Sam", room: room.engineering, role: "DevOps Engineer", capabilities: ["infrastructure_operations", "technical_design"] },
  { id: seed(3), name: "Harvey", room: room.finance, capabilities: ["calculation", "financial_analysis", "decision_support"] },
  { id: seed(16), name: "Brienne", room: room.operations, role: "Project Coordinator", capabilities: ["project_coordination", "scheduling", "writing"] },
  { id: seed(17), name: "Davos", room: room.operations, role: "Procurement & Vendor Manager", capabilities: ["procurement", "vendor_management", "calculation"] },
  { id: seed(11), name: "Jessica", room: room.product, role: "Product Manager", capabilities: ["product_management", "stakeholder_messaging", "writing"] },
  { id: seed(4), name: "Mike", room: room.research, capabilities: ["research", "synthesis", "writing"] },
  { id: seed(12), name: "Rachel", room: room.research, role: "Product Researcher", capabilities: ["product_research", "research", "synthesis"] },
  { id: seed(13), name: "Donna", room: room.revenue, role: "Account Executive", capabilities: ["sales", "stakeholder_messaging", "writing"] },
  { id: seed(14), name: "Louis", room: room.revenue, role: "Marketing Manager", capabilities: ["marketing", "communication", "writing"] },
  { id: seed(15), name: "Sansa", room: room.revenue, role: "Growth & Content Lead", capabilities: ["content_creation", "growth_analysis", "writing"] },
];

const newcomers = people.filter((person) => person.role);
const roomNames: Record<string, string> = {
  [room.hall]: "Company hall",
  [room.customers]: "Customer Success",
  [room.engineering]: "Engineering",
  [room.finance]: "Finance",
  [room.operations]: "Operations",
  [room.product]: "Product",
  [room.research]: "Research",
  [room.revenue]: "Revenue & Growth",
};

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
    const profile = /\/workforce\/([^/]+)$/.exec(call.url.pathname);
    if (profile) {
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

describe("the world with all twenty", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  it("draws a desk for every one of the twenty, in their room, and counts them", async () => {
    const { container } = open();
    await waitFor(() => expect(container.querySelectorAll(".world-desk")).toHaveLength(20));

    expect(screen.getByText(/20 agents in 8 rooms/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Everyone 20" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Available 20" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Engineering. 6 agents." })).toBeDefined();
    expect(screen.getByRole("button", { name: "Revenue & Growth. 3 agents." })).toBeDefined();
  });

  it("finds each of the twelve by part of their name, in any case, and by what the room is called", async () => {
    open();
    const search = await screen.findByRole("searchbox", { name: "Find in the office" });

    for (const person of newcomers) {
      await userEvent.clear(search);
      await userEvent.type(search, person.name.slice(0, 4).toUpperCase());
      const hits = within(screen.getByRole("list", { name: "Matches" })).getAllByRole("button").map((hit) => hit.textContent);
      expect(hits.some((hit) => hit?.startsWith(`Agent ${person.name}`)), `${person.name}: ${JSON.stringify(hits)}`).toBe(true);
    }

    await userEvent.clear(search);
    await userEvent.type(search, "revenue");
    expect(within(screen.getByRole("list", { name: "Matches" })).getAllByRole("button")[0]!.textContent).toMatch(/^Room Revenue & Growth/);
  });

  it("shows each of the twelve's role, room, tools and skills in their details", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "List" }));

    for (const person of newcomers) {
      await userEvent.click(screen.getByRole("button", { name: person.name }));
      const details = screen.getByRole("complementary", { name: `Details: ${person.name}` });

      expect(within(details).getByText(person.role!), person.name).toBeDefined();
      expect(within(details).getByText(roomNames[person.room]!), person.name).toBeDefined();
      expect(await within(details).findByRole("list", { name: "Tools" }), person.name).toBeDefined();
      expect(within(details).getByRole("list", { name: "Skills" }), person.name).toBeDefined();
      expect(details.textContent, person.name).not.toContain(person.id);
    }
  });

  it("keeps the twelve with everyone else in the state filters", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "List" }));

    await userEvent.click(screen.getByRole("button", { name: "Working 0" }));
    expect(screen.getByRole("status").textContent).toBe("Nobody is in that state right now.");

    await userEvent.click(screen.getByRole("button", { name: "Everyone 20" }));
    for (const person of newcomers) expect(screen.getByRole("button", { name: person.name })).toBeDefined();
  });

  it("draws roommates who share a discipline so they can be told apart", () => {
    for (const roomId of Object.keys(roomNames)) {
      const here = people.filter((person) => person.room === roomId);
      const looks = here.map((person) => {
        const discipline = disciplineOf({ type: person.type ?? "specialist", capabilities: person.capabilities });
        const look = lookOf(person.id, discipline);
        return `${discipline}/${look.hair}/${look.haircut}`;
      });

      expect(new Set(looks).size, roomNames[roomId]).toBe(looks.length);
    }
  });
});
