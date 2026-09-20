import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { CompanyReadiness, OrganizationRole, ReadinessAbility } from "../lib/api";
import { signedInAs } from "../test/access";
import { deferred, json, stubNetwork } from "../test/network";
import Readiness from "./Readiness";

/**
 * Company readiness as a person sees it, over the real client with only the
 * network scripted.
 *
 * The page is not allowed to decide anything, so these tests are mostly about
 * that: the sentence shown is the server's sentence, an ability is offered as
 * fixable only when the server said this person could fix it, and the first
 * morning appears only for a company that has never been given a mission.
 */

function ability(name: string, overrides: Partial<ReadinessAbility> = {}): ReadinessAbility {
  return {
    slug: name.toLowerCase().replace(/ /g, "-"),
    name,
    description: `How ${name} is done.`,
    area: "finance",
    ready: true,
    agents: [{ id: "agent-harvey", name: "Harvey" }],
    needsApproval: false,
    reason: "Harvey can do this.",
    ...overrides,
  };
}

const blockedAbility = ability("Spreadsheet analysis", {
  area: "finance",
  ready: false,
  agents: [],
  reason: "Harvey needs Calculator.",
  shortfall: { kind: "missing_tool", agent: { id: "agent-harvey", name: "Harvey" }, tools: [{ id: "calculator", name: "Calculator" }], capabilities: [] },
  fix: { label: "Prepare Harvey", path: "/workforce/agent-harvey" },
});

function readiness(overrides: Partial<CompanyReadiness> = {}): CompanyReadiness {
  return {
    organizationId: "org",
    generatedAt: new Date().toISOString(),
    state: "partly_ready",
    headline: "Your workforce is ready for most things.",
    detail: "1 thing the company can be asked for now. 1 other needs setting up first.",
    summary: { abilities: 2, ready: 1, blocked: 1, agents: 3, activeAgents: 3 },
    areas: [
      { area: "finance", name: "Finance", ready: [ability("Financial analysis")], blocked: [blockedAbility] },
    ],
    firstRun: { pending: false, canPrepareWorkforce: true, canStartMission: true },
    ...overrides,
  };
}

function open(
  role: OrganizationRole,
  respond: () => Response | Promise<Response> = () => json(200, readiness()),
) {
  stubNetwork((call) =>
    call.url.pathname === "/company-readiness" ? respond() : json(200, {}));

  const router = createMemoryRouter(
    [
      {
        path: "/readiness",
        element: (
          <AccessContext.Provider value={signedInAs(role)}>
            <Readiness />
          </AccessContext.Provider>
        ),
      },
    ],
    { initialEntries: ["/readiness"] },
  );

  render(<RouterProvider router={router} />);
}

describe("company readiness", () => {
  it("says it is checking the workforce until the API answers", async () => {
    const pending = deferred<Response>();
    open("owner", () => pending.promise);

    expect(screen.getByRole("status").textContent).toContain("Checking your workforce");

    pending.resolve(json(200, readiness()));
    expect(await screen.findByText("Financial analysis")).toBeDefined();
  });

  it("says what the company can do and what is missing, in the server's words", async () => {
    open("owner");
    await screen.findByText("Financial analysis");

    expect(screen.getByText("Your workforce is ready for most things.")).toBeDefined();
    expect(screen.getByText("Harvey can do this.")).toBeDefined();
    expect(screen.getByText("Spreadsheet analysis")).toBeDefined();
    expect(screen.getByText("Harvey needs Calculator.")).toBeDefined();
  });

  it("sends someone who can prepare the workforce to the agent that needs it", async () => {
    open("owner");
    await screen.findByText("Spreadsheet analysis");

    expect(screen.getByRole("link", { name: /Prepare Harvey/ }).getAttribute("href"))
      .toBe("/workforce/agent-harvey");
  });

  it("offers no configuration action to someone the server did not offer one to", async () => {
    const forMember = readiness({
      areas: [{
        area: "finance",
        name: "Finance",
        ready: [],
        blocked: [{ ...blockedAbility, fix: undefined }],
      }],
      firstRun: { pending: false, canPrepareWorkforce: false, canStartMission: true },
    });

    open("member", () => json(200, forMember));
    await screen.findByText("Spreadsheet analysis");

    expect(screen.queryByRole("link", { name: /Prepare Harvey/ })).toBeNull();
    expect(screen.getByText("An owner needs to set this up.")).toBeDefined();
  });

  it("does not offer a viewer the mission they could not open", async () => {
    open("viewer", () => json(200, readiness({
      firstRun: { pending: false, canPrepareWorkforce: false, canStartMission: false },
    })));
    await screen.findByText("Financial analysis");

    expect(screen.queryByRole("link", { name: /Start a mission/ })).toBeNull();
    expect(screen.getByText(/can follow missions but not open them/)).toBeDefined();
  });

  it("walks a company that has never been given a mission through its first morning", async () => {
    open("owner", () => json(200, readiness({
      firstRun: { pending: true, canPrepareWorkforce: true, canStartMission: true },
    })));

    const welcome = await screen.findByRole("region", { name: "Getting started" });

    expect(within(welcome).getByText("Your workforce")).toBeDefined();
    expect(within(welcome).getByText("Your first mission")).toBeDefined();
    expect(within(welcome).getByRole("link", { name: /Start it/ }).getAttribute("href")).toBe("/missions/new");
  });

  it("does not walk a company that has already worked through it again", async () => {
    open("owner");
    await screen.findByText("Financial analysis");

    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });

  it("says nothing can be given to anyone rather than showing an empty list", async () => {
    open("owner", () => json(200, readiness({
      state: "no_workforce",
      headline: "Nobody works here yet.",
      detail: "Nothing can be given to anyone until at least one agent is working here.",
      summary: { abilities: 0, ready: 0, blocked: 0, agents: 0, activeAgents: 0 },
      areas: [],
    })));

    // Said twice on purpose: once as the page's reading, once where the list
    // of abilities would have been.
    expect(await screen.findAllByText("Nobody works here yet.")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "The workforce" }).getAttribute("href")).toBe("/workforce");
  });

  it("explains a failed read without showing the workforce as broken", async () => {
    open("owner", () => json(500, { error: "The database is unreachable." }));

    expect(await screen.findByText(/couldn't load company readiness/i)).toBeDefined();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("keeps the last good reading when a refresh fails, and says it is doing so", async () => {
    let answered = false;
    open("owner", () => {
      if (answered) return json(500, { error: "The database is unreachable." });
      answered = true;
      return json(200, readiness());
    });

    await screen.findByText("Financial analysis");

    // Coming back to the tab re-reads, the way a person returning to it would.
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByText(/showing what was last loaded/i)).toBeDefined();
    expect(screen.getByText("Financial analysis")).toBeDefined();
  });
});
