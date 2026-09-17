import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useParams } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { deferred, json, stubNetwork } from "../test/network";
import { financialReview } from "../test/templates";
import MissionStart from "./MissionStart";

function ConfigureProbe() {
  const { templateId } = useParams();
  return <p>Configuring {templateId}</p>;
}

function renderPage(templates: () => Response | Promise<Response>) {
  stubNetwork((call) => {
    switch (call.url.pathname) {
      case "/mission-templates":
        return templates();
      case "/agents":
        return json(200, { agents: [] });
      case "/workspaces":
        return json(200, { workspaces: [] });
      default:
        return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
    }
  });

  const router = createMemoryRouter(
    [
      { path: "/missions/new", element: <MissionStart /> },
      { path: "/missions/new/:templateId", element: <ConfigureProbe /> },
    ],
    { initialEntries: ["/missions/new"] },
  );

  render(<RouterProvider router={router} />);
}

function templateSection() {
  return screen.getByRole("region", { name: "Or start from a template" });
}

describe("the template chooser on the mission page", () => {
  it("shows a loading state until the templates arrive", async () => {
    const release = deferred<Response>();
    renderPage(() => release.promise);

    expect(templateSection().querySelector("[aria-busy='true']")).not.toBeNull();

    release.resolve(json(200, { templates: [financialReview()] }));

    expect(
      await within(templateSection()).findByRole("heading", { name: "Prepare a Financial Review" }),
    ).toBeDefined();
    expect(templateSection().querySelector("[aria-busy='true']")).toBeNull();
  });

  it("describes each template from what the API returned", async () => {
    renderPage(() => json(200, { templates: [financialReview()] }));

    const section = templateSection();
    await within(section).findByRole("heading", { name: "Prepare a Financial Review" });

    expect(within(section).getByText(/Look hard at the numbers/)).toBeDefined();
    expect(within(section).getByText("A review with the figures checked")).toBeDefined();
    expect(within(section).getByText("Tyrion · Harvey")).toBeDefined();
    expect(within(section).getByText("Focused")).toBeDefined();
    expect(within(section).getByText("A rule may ask for approval")).toBeDefined();
  });

  it("does not claim approval is likely when no rule gates the team", async () => {
    renderPage(() =>
      json(200, {
        templates: [financialReview({ governance: { gatingPolicies: [] }, likelyTeam: [], planner: undefined })],
      }),
    );

    const section = templateSection();
    await within(section).findByRole("heading", { name: "Prepare a Financial Review" });

    expect(within(section).getByText("No rule gates this team today")).toBeDefined();
    expect(within(section).getByText(/Nobody on the roster holds these disciplines yet/)).toBeDefined();
  });

  it("says so when there are no templates, leaving the free-form mission usable", async () => {
    renderPage(() => json(200, { templates: [] }));

    expect(await screen.findByText("No templates are available")).toBeDefined();
    expect(screen.getByLabelText("The objective")).toBeDefined();
  });

  it("says plainly when the templates cannot be read", async () => {
    renderPage(() =>
      json(500, { error: { code: "INTERNAL_ERROR", message: "An internal error occurred." } }),
    );

    expect(await within(templateSection()).findByText(/UNIOFFICE couldn't complete that right now/)).toBeDefined();
  });

  it("choosing a template opens its configuration", async () => {
    renderPage(() => json(200, { templates: [financialReview()] }));
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("link", { name: "Start mission: Prepare a Financial Review" }),
    );

    expect(await screen.findByText("Configuring prepare-a-financial-review")).toBeDefined();
  });
});
