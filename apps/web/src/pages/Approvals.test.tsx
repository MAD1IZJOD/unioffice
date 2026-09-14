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
