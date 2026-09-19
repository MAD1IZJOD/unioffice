import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, useLocation, useParams } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { deferred, json, stubNetwork, type RecordedCall } from "../test/network";
import { financialReview } from "../test/templates";
import TemplateMission from "./TemplateMission";

/**
 * The page is rendered inside a real router with the real API client; only
 * the network answers are scripted. The mission route is a probe that shows
 * what the execution room would receive.
 */

function MissionProbe() {
  const { missionId } = useParams();
  const location = useLocation();

  return (
    <div>
      <p>Mission room for {missionId}</p>
      <p>state: {JSON.stringify(location.state)}</p>
    </div>
  );
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: "/missions/new", element: <p>Every template</p> },
      { path: "/missions/new/:templateId", element: <TemplateMission /> },
      { path: "/missions/:missionId", element: <MissionProbe /> },
    ],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
  return router;
}

function api(
  overrides: { template?: (call: RecordedCall) => Response | Promise<Response>; start?: (call: RecordedCall) => Response | Promise<Response> } = {},
) {
  return stubNetwork((call) => {
    const path = call.url.pathname;

    if (path === "/workspaces") return json(200, { workspaces: [] });
    if (call.method === "GET" && path === "/mission-templates/prepare-a-financial-review") {
      return overrides.template ? overrides.template(call) : json(200, financialReview());
    }
    if (call.method === "POST" && path === "/mission-templates/prepare-a-financial-review/missions") {
      return overrides.start
        ? overrides.start(call)
        : json(201, { work: { id: "9f0e0000-0000-4000-8000-000000000001", status: "queued" } });
    }

    return json(404, { error: { code: "NOT_FOUND", message: "Not found." } });
  });
}

/**
 * Fills the required answers. Pasted rather than typed key by key: what these
 * tests check is what the page does with the answers, and typing each one a
 * character at a time re-rendered the whole page per keystroke - enough to
 * push a test past its time limit on a busy machine.
 */
async function fillRequired() {
  const user = userEvent.setup();

  await user.click(screen.getByLabelText(/What the review should answer/));
  await user.paste("Are we on track against the quarter's budget?");
  await user.click(screen.getByLabelText(/What should exist at the end/));
  await user.paste("A one-page summary.");

  return user;
}

describe("starting a mission from a template", () => {
  it("shows a loading state, then the template with its real team and rules", async () => {
    const release = deferred<Response>();
    api({ template: () => release.promise });

    renderAt("/missions/new/prepare-a-financial-review");

    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();

    release.resolve(json(200, financialReview()));

    expect(
      await screen.findByRole("heading", { name: /Prepare a Financial Review/ }),
    ).toBeDefined();
    expect(screen.getByText("Harvey")).toBeDefined();
    expect(screen.getByText("Tyrion")).toBeDefined();
    expect(screen.getByText("Finance sign-off")).toBeDefined();
    expect(screen.getByText("ask a person")).toBeDefined();
  });

  it("says plainly when the template does not exist", async () => {
    api({
      template: () => json(404, { error: { code: "NOT_FOUND", message: "Mission template not found." } }),
    });

    renderAt("/missions/new/prepare-a-financial-review");

    expect(await screen.findByText("That template does not exist")).toBeDefined();
    expect(screen.getByRole("link", { name: "See the templates" }).getAttribute("href")).toBe(
      "/missions/new",
    );
  });

  it("says plainly when the template cannot be read", async () => {
    api({
      template: () => json(500, { error: { code: "INTERNAL_ERROR", message: "An internal error occurred." } }),
    });

    renderAt("/missions/new/prepare-a-financial-review");

    expect(await screen.findByText(/UNIOFFICE couldn't complete that right now/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Start mission/ })).toBeNull();
  });

  it("explains what is missing and sends nothing when the answers are incomplete", async () => {
    const calls = api();
    const user = userEvent.setup();

    renderAt("/missions/new/prepare-a-financial-review");
    await screen.findByRole("heading", { name: /Prepare a Financial Review/ });

    await user.click(screen.getByRole("button", { name: /Start mission/ }));

    expect(screen.getByText(/Say what the mission is for/)).toBeDefined();
    expect(screen.getByText(/Say what should exist when it is done/)).toBeDefined();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("refuses an answer longer than the API accepts before sending it", async () => {
    const calls = api();

    renderAt("/missions/new/prepare-a-financial-review");
    await screen.findByRole("heading", { name: /Prepare a Financial Review/ });

    const user = await fillRequired();
    fireEvent.change(screen.getByLabelText(/Rules it must keep to/), {
      target: { value: "k".repeat(601) },
    });

    await user.click(screen.getByRole("button", { name: /Start mission/ }));

    expect(screen.getByText(/Keep this to 600 characters or fewer/)).toBeDefined();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("starts the mission, shows it is starting, and opens the execution room to plan it", async () => {
    const release = deferred<Response>();
    const calls = api({ start: () => release.promise });

    renderAt("/missions/new/prepare-a-financial-review");
    await screen.findByRole("heading", { name: /Prepare a Financial Review/ });

    const user = await fillRequired();
    await user.type(screen.getByLabelText(/Figures and background/), "Salaries 48200.");
    await user.type(screen.getByLabelText(/Name it/), "Q3 burn review");
    await user.click(screen.getByRole("button", { name: "High" }));
    await user.click(screen.getByRole("button", { name: /Start mission/ }));

    const starting = await screen.findByRole("button", { name: /Starting/ });
    expect((starting as HTMLButtonElement).disabled).toBe(true);

    const post = calls.find((call) => call.method === "POST")!;
    expect(post.body).toEqual({
      organizationId: "2f6b579a-f0f8-45a5-868a-21c08bde1314",
      name: "Q3 burn review",
      objective: "Are we on track against the quarter's budget?",
      context: "Salaries 48200.",
      desiredOutcome: "A one-page summary.",
      priority: "high",
    });
    // The page never claims who is asking or what the mission may do.
    expect(Object.keys(post.body as object)).not.toContain("requesterId");

    release.resolve(
      json(201, { work: { id: "9f0e0000-0000-4000-8000-000000000001", status: "queued" } }),
    );

    expect(
      await screen.findByText("Mission room for 9f0e0000-0000-4000-8000-000000000001"),
    ).toBeDefined();
    expect(screen.getByText('state: {"autostart":true}')).toBeDefined();
  });

  it("keeps the answers and says nothing started when the API refuses", async () => {
    api({
      start: () => json(400, { error: { code: "VALIDATION_ERROR", message: "objective must be text." } }),
    });

    renderAt("/missions/new/prepare-a-financial-review");
    await screen.findByRole("heading", { name: /Prepare a Financial Review/ });

    const user = await fillRequired();
    await user.click(screen.getByRole("button", { name: /Start mission/ }));

    expect(await screen.findByText("The mission was not started")).toBeDefined();
    expect(screen.getByText("objective must be text.")).toBeDefined();
    expect(screen.getByText("Nothing was recorded. Nothing is running.")).toBeDefined();

    await waitFor(() => {
      expect(
        (screen.getByRole("button", { name: /Start mission/ }) as HTMLButtonElement).disabled,
      ).toBe(false);
    });
    expect(
      (screen.getByLabelText(/What should exist at the end/) as HTMLTextAreaElement).value,
    ).toBe("A one-page summary.");
  });
});
