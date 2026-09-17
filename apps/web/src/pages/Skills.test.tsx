import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { OrganizationRole, SkillItem } from "../lib/api";
import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import Skill, { NewSkill } from "./Skill";
import Skills from "./Skills";

/** Skills as each role sees them, over the real client with the network scripted. */

function skill(overrides: Partial<SkillItem> = {}): SkillItem {
  return {
    id: "system:financial-analysis",
    scope: "system",
    workspace: null,
    slug: "financial-analysis",
    name: "Financial analysis",
    description: "Analyse financial figures.",
    category: "finance",
    version: 1,
    status: "active",
    instructions: "Use the calculator for every figure.",
    inputs: [{ name: "figures", type: "table", description: "The data.", required: true }],
    outputs: [{ name: "conclusion", type: "text", description: "What it means.", required: true }],
    requiredTools: ["calculator"],
    requiredCapabilities: ["financial_analysis"],
    approval: "none",
    memory: "recall",
    overrides: null,
    overriddenBy: null,
    agents: [{ id: "agent-harvey", name: "Harvey", fits: true, missingTools: [], missingCapabilities: [] }],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const catalogue = [
  skill(),
  skill({ id: "system:code-review", slug: "code-review", name: "Code review", description: "Review a change.", category: "engineering", requiredTools: [], requiredCapabilities: ["coding"], agents: [] }),
  skill({ id: "system:candidate-screening", slug: "candidate-screening", name: "Candidate screening", category: "people", approval: "required", requiredTools: [], requiredCapabilities: ["people_operations"], agents: [] }),
  skill({ id: "c0000000-0000-4000-8000-000000000001", scope: "organization", slug: "expense-review", name: "Expense review", status: "draft", version: 2, agents: [] }),
];

function open(role: OrganizationRole, path: string, detail?: SkillItem) {
  const calls = stubNetwork((call) => {
    if (call.method === "GET" && call.url.pathname === "/skills") return json(200, { skills: catalogue });
    if (call.method === "GET" && call.url.pathname.startsWith("/skills/")) {
      return detail ? json(200, { skill: detail }) : json(404, { error: { code: "NOT_FOUND", message: "Skill not found." } });
    }
    if (call.url.pathname === "/tools") return json(200, { tools: [{ id: "calculator", name: "Calculator", description: "", version: "1", inputSchema: {} }] });
    if (call.url.pathname === "/workspaces") return json(200, { workspaces: [] });
    if (call.method === "POST") return json(200, { skill: detail ?? catalogue[3] });
    return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  });

  const wrap = (element: React.ReactNode) => <AccessContext.Provider value={signedInAs(role)}>{element}</AccessContext.Provider>;
  const router = createMemoryRouter(
    [
      { path: "/skills", element: wrap(<Skills />) },
      { path: "/skills/new", element: wrap(<NewSkill />) },
      { path: "/skills/:skillRef", element: wrap(<Skill />) },
    ],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
  return calls;
}

describe("the skills catalogue", () => {
  it("groups skills by category, says whether each can actually be used, and offers a viewer nothing to write", async () => {
    open("viewer", "/skills");

    const finance = await screen.findByRole("region", { name: "Finance" });
    const row = within(finance).getByRole("listitem", { name: "Financial analysis" });
    expect(within(row).getByText("Harvey can run it")).toBeDefined();
    expect(within(row).getByText("calculator")).toBeDefined();

    expect(within(screen.getByRole("region", { name: "People" })).getByText("Every step needs approval")).toBeDefined();
    expect(screen.queryByRole("link", { name: /New skill/ })).toBeNull();
  });

  it("filters by category, source and search", async () => {
    open("owner", "/skills");
    const user = userEvent.setup();

    await screen.findByRole("region", { name: "Finance" });
    expect(screen.getByRole("link", { name: /New skill/ })).toBeDefined();

    await user.click(screen.getByRole("tab", { name: "Engineering" }));
    expect(screen.queryByRole("region", { name: "Finance" })).toBeNull();
    expect(screen.getByRole("listitem", { name: "Code review" })).toBeDefined();

    await user.click(screen.getByRole("tab", { name: "All" }));
    await user.selectOptions(screen.getByLabelText("Where skills come from"), "company");
    expect(screen.getByRole("listitem", { name: "Expense review" })).toBeDefined();
    expect(screen.queryByRole("listitem", { name: "Code review" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Where skills come from"), "all");
    await user.type(screen.getByLabelText("Search skills"), "people_operations");
    expect(screen.getByRole("listitem", { name: "Candidate screening" })).toBeDefined();
    expect(screen.queryByRole("listitem", { name: "Financial analysis" })).toBeNull();
  });

  it("separates the skills the workforce can actually use from the ones it cannot", async () => {
    open("owner", "/skills");
    const user = userEvent.setup();

    await screen.findByRole("region", { name: "Finance" });

    await user.selectOptions(screen.getByLabelText("Whether a skill can be used"), "ready");
    expect(screen.getByRole("listitem", { name: "Financial analysis" })).toBeDefined();
    expect(screen.queryByRole("listitem", { name: "Code review" })).toBeNull();

    await user.selectOptions(screen.getByLabelText("Whether a skill can be used"), "not_ready");
    expect(screen.queryByRole("listitem", { name: "Financial analysis" })).toBeNull();

    const codeReview = screen.getByRole("listitem", { name: "Code review" });
    expect(within(codeReview).getByText("No agent holds it")).toBeDefined();
  });
});

describe("a skill's page", () => {
  it("shows the procedure, requirements and holders; a system skill can only be adapted, by managers", async () => {
    open("owner", "/skills/system%3Afinancial-analysis", skill());

    expect(await screen.findByRole("heading", { name: "Financial analysis" })).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Procedure" })).getByText("Use the calculator for every figure.")).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Agents" })).getByText("Can use it")).toBeDefined();
    expect(screen.getByRole("link", { name: /Adapt for the company/ })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("offers a member no changes at all", async () => {
    open("member", "/skills/system%3Afinancial-analysis", skill());

    await screen.findByRole("heading", { name: "Financial analysis" });
    expect(screen.queryByRole("link", { name: /Adapt/ })).toBeNull();
  });

  it("activates a draft with the version it was read at", async () => {
    const draft = catalogue[3]!;
    const calls = open("admin", `/skills/${draft.id}`, draft);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Activate" }));

    await waitFor(() => expect(calls.some((call) => call.url.pathname.endsWith("/status"))).toBe(true));
    const request = calls.find((call) => call.url.pathname.endsWith("/status"))!;
    expect(request.body).toEqual({ organizationId: expect.any(String), status: "active", expectedVersion: 2 });
  });

  it("says plainly when a skill cannot be reached", async () => {
    open("member", "/skills/c0000000-0000-4000-8000-000000000009");

    expect(await screen.findByText("This skill is not here")).toBeDefined();
  });
});

describe("writing a skill", () => {
  it("sends only the skill's own fields, and never a scope of system", async () => {
    const calls = open("owner", "/skills/new");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Name"), "Expense review");
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("expense-review");
    await user.type(screen.getByLabelText("Procedure"), "Compare each line.");
    await user.click(screen.getByRole("checkbox", { name: "Calculator" }));
    await user.click(screen.getByRole("button", { name: "Create skill" }));

    await waitFor(() => expect(calls.some((call) => call.method === "POST")).toBe(true));
    const body = calls.find((call) => call.method === "POST")!.body as Record<string, unknown>;

    expect(body.scope).toBe("organization");
    expect(body.status).toBe("draft");
    expect(body.requiredTools).toEqual(["calculator"]);
    expect(Object.keys(body).sort()).toEqual([
      "approval", "category", "description", "inputs", "instructions", "memory", "name", "organizationId",
      "outputs", "requiredCapabilities", "requiredTools", "scope", "slug", "status",
    ]);
  });

  it("tells a member they cannot write skills", async () => {
    open("member", "/skills/new");
    expect(await screen.findByText("Your role cannot write skills")).toBeDefined();
  });
});
