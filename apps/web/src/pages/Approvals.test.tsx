import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { ApprovalItem, OrganizationRole } from "../lib/api";
import { signedInAs } from "../test/access";
import { json, stubNetwork } from "../test/network";
import Approvals from "./Approvals";

/**
 * What each role is offered on the approvals queue. The planner's own request
 * can be decided by a member; a step a governance policy requires is offered
 * only to owners and admins. The API refuses anyone else either way.
 */

const createdAt = new Date(Date.now() - 60_000).toISOString();

function approval(id: string, metadata: Record<string, unknown>): ApprovalItem {
  return {
    id,
    workId: "c0000000-0000-4000-8000-000000000001",
    taskId: "t1",
    action: id === "planner" ? "Send the launch brief" : "Pay the supplier",
    resource: "task:t1",
    reason: "A person must sign this off.",
    status: "pending",
    createdAt,
    metadata,
  };
}

function open(role: OrganizationRole) {
  stubNetwork((call) =>
    call.url.pathname === "/approvals"
      ? json(200, { approvals: [approval("planner", {}), approval("governed", { policyId: "policy-1", policyName: "Payments" })] })
      : json(404, { error: { code: "NOT_FOUND", message: "Not found." } }));

  const router = createMemoryRouter(
    [{
      path: "/approvals",
      element: (
        <AccessContext.Provider value={signedInAs(role)}>
          <Approvals />
        </AccessContext.Provider>
      ),
    }],
    { initialEntries: ["/approvals"] },
  );

  render(<RouterProvider router={router} />);
}

describe("the approvals queue, by role", () => {
  it("shows a viewer what is waiting but offers no decision", async () => {
    open("viewer");

    expect(await screen.findByText("Send the launch brief")).toBeDefined();
    expect(screen.getAllByText("Your role can see this step but not decide it.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Approve and continue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("offers a member the planner's step, and tells them who decides the policy's", async () => {
    open("member");

    await screen.findByText("Pay the supplier");
    expect(screen.getAllByRole("button", { name: "Approve and continue" })).toHaveLength(1);
    expect(screen.getByText("A governance policy requires an owner or admin to decide this step.")).toBeDefined();
  });

  it("offers an admin both", async () => {
    open("admin");

    await screen.findByText("Pay the supplier");
    expect(screen.getAllByRole("button", { name: "Approve and continue" })).toHaveLength(2);
  });
});

describe("an approval with the server's briefing", () => {
  function briefed(youCanDecide: boolean) {
    return {
      ...approval("governed", { externalWrites: ["github_create_issue"] }),
      briefing: {
        mission: { id: "c0000000-0000-4000-8000-000000000001", objective: "File the regression.", workspace: "Engineering" },
        step: { title: "Open the issue", description: "Create an issue in acme/app." },
        agent: { id: "agent-tony", name: "Tony" },
        requestedBy: "external_write" as const,
        policy: null,
        skill: null,
        proposal: {
          id: "p0000000-0000-4000-8000-000000000001",
          summary: 'Tony would carry out "Open the issue" following Issue filing version 2, using Create GitHub issue.',
          skill: { name: "Issue filing", version: 2 },
        },
        externalWrites: ["Create GitHub issue"],
        tools: ["Create GitHub issue"],
        risk: "high" as const,
        onApprove: "Tony runs this step and may use Create GitHub issue once.",
        onReject: "The step does not run and the mission stops here.",
        decidedBy: "owners_and_admins" as const,
        youCanDecide,
      },
    };
  }

  function openWith(role: OrganizationRole, youCanDecide: boolean) {
    stubNetwork((call) =>
      call.url.pathname === "/approvals"
        ? json(200, { approvals: [briefed(youCanDecide)] })
        : json(404, { error: { code: "NOT_FOUND", message: "Not found." } }));

    const router = createMemoryRouter(
      [{ path: "/approvals", element: <AccessContext.Provider value={signedInAs(role)}><Approvals /></AccessContext.Provider> }],
      { initialEntries: ["/approvals"] },
    );

    render(<RouterProvider router={router} />);
  }

  it("says what is approved, why, who waits, and what each answer does", async () => {
    openWith("admin", true);

    const card = await screen.findByRole("article", { name: "Open the issue" });
    expect(card.textContent).toMatch(/Tony is waiting/);
    expect(card.textContent).toMatch(/File the regression/);
    expect(card.textContent).toMatch(/changes something outside the company/);
    expect(card.textContent).toMatch(/may use Create GitHub issue once/);
    expect(card.textContent).toMatch(/mission stops here/);
    expect(card.textContent).toMatch(/high risk/);
    expect(screen.getByRole("button", { name: "Approve and continue" })).toBeDefined();
  });

  it("follows the server's answer on who may decide, not the role alone", async () => {
    openWith("member", false);

    await screen.findByRole("article", { name: "Open the issue" });
    expect(screen.queryByRole("button", { name: "Approve and continue" })).toBeNull();
    expect(screen.getByText("An owner or admin decides this step.")).toBeDefined();
  });

  it("shows the exact action being decided, and says the decision is bound to it", async () => {
    openWith("admin", true);

    expect(await screen.findByText(/following Issue filing version 2/)).toBeDefined();
    expect(screen.getByText("Issue filing, version 2")).toBeDefined();
    expect(screen.getByText(/If the step changes before it runs, it comes back to you/)).toBeDefined();
  });
});
