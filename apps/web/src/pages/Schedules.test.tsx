import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AccessContext } from "../lib/access";
import type { ContinuousMissionDetail, ContinuousMissionItem, OrganizationRole } from "../lib/api";
import { signedInAs } from "../test/access";
import { deferred, json, stubNetwork, type RecordedCall } from "../test/network";
import Schedule from "./Schedule";
import Schedules from "./Schedules";

/**
 * Schedules as each role sees them, over the real client with the network
 * scripted in the shape the API returns.
 */

const inFourDays = new Date(Date.now() + 4 * 86_400_000).toISOString();
const anHourAgo = new Date(Date.now() - 3_600_000).toISOString();

function mission(overrides: Partial<ContinuousMissionItem> = {}): ContinuousMissionItem {
  return {
    id: "cm-1",
    name: "Competitor pricing watch",
    objective: "Check competitor pricing and say if anything material changed.",
    priority: "normal",
    schedule: { cadence: "weekly", dayOfWeek: 1, hour: 9, minute: 0, timezone: "Asia/Kolkata" },
    cadence: "Every Monday at 09:00 (Asia/Kolkata)",
    status: "active",
    nextRunAt: inFourDays,
    runCount: 0,
    ownedByYou: true,
    createdAt: anHourAgo,
    updatedAt: anHourAgo,
    ...overrides,
  };
}

function detail(overrides: Partial<ContinuousMissionDetail> = {}): ContinuousMissionDetail {
  return { ...mission(), runs: [], skipped: 0, ...overrides };
}

function open(
  role: OrganizationRole,
  path: string,
  route: (call: RecordedCall) => Response | Promise<Response>,
) {
  const calls = stubNetwork((call) => {
    if (call.url.pathname === "/workspaces") return json(200, { workspaces: [] });
    return route(call);
  });

  const wrap = (element: React.ReactNode) => <AccessContext.Provider value={signedInAs(role)}>{element}</AccessContext.Provider>;
  const router = createMemoryRouter(
    [
      { path: "/schedules", element: wrap(<Schedules />) },
      { path: "/schedules/:scheduleId", element: wrap(<Schedule />) },
      { path: "/missions/:missionId", element: <p>A mission</p> },
    ],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
  return { calls, router };
}

describe("the schedules list", () => {
  it("says it is reading while the first answer is on its way", async () => {
    const release = deferred<Response>();
    open("owner", "/schedules", () => release.promise);

    expect(await screen.findByText("Reading the schedules…")).toBeDefined();
    release.resolve(json(200, { missions: [] }));
    expect(await screen.findByText("Nothing runs on a schedule yet.")).toBeDefined();
  });

  it("lists each schedule with how often it runs, its next run and how the last one went", async () => {
    open("member", "/schedules", () => json(200, {
      missions: [
        mission({ latestRun: { sequence: 3, workId: "w3", trigger: "schedule", scheduledFor: anHourAgo, startedAt: anHourAgo, state: "waiting_for_approval" } }),
        mission({
          id: "cm-2",
          name: "Weekly close",
          status: "paused",
          pauseReason: "repeated_failures",
          pauseNote: "It stopped itself after its last runs failed one after another.",
          nextRunAt: undefined,
        }),
      ],
    }));

    const row = await screen.findByRole("listitem", { name: "Competitor pricing watch" });
    expect(within(row).getByText("Every Monday at 09:00 (Asia/Kolkata)")).toBeDefined();
    expect(within(row).getByText(/Next run in 4 days/)).toBeDefined();
    expect(within(row).getByText("Waiting for approval")).toBeDefined();
    expect(row.getAttribute("href")).toBe("/schedules/cm-1");

    const stopped = screen.getByRole("listitem", { name: "Weekly close" });
    expect(within(stopped).getByText("Stopped itself")).toBeDefined();
    expect(within(stopped).getByText(/failed one after another/)).toBeDefined();
  });

  it("offers a viewer nothing to set up", async () => {
    open("viewer", "/schedules", () => json(200, { missions: [mission()] }));

    await screen.findByRole("listitem", { name: "Competitor pricing watch" });
    expect(screen.queryByRole("button", { name: /New schedule/ })).toBeNull();
  });

  it("says when it cannot read the schedules, and that nothing stopped running", async () => {
    open("owner", "/schedules", () => json(500, { error: { code: "INTERNAL", message: "An internal error occurred." } }));

    expect(await screen.findByText("UNIOFFICE couldn't load the schedules")).toBeDefined();
    expect(screen.getByText(/Schedules keep running on the server/)).toBeDefined();
  });

  it("keeps what it last read when a refresh fails, and says so", async () => {
    let reads = 0;
    open("member", "/schedules/cm-1", (call) => {
      if (call.method === "POST") return json(200, { mission: detail({ status: "paused", pauseReason: "person", nextRunAt: undefined }) });
      reads += 1;
      return reads === 1
        ? json(200, { mission: detail() })
        : json(503, { error: { code: "UNAVAILABLE", message: "Down." } });
    });

    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));

    expect(await screen.findByText(/The latest refresh failed - showing what was last loaded/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Competitor pricing watch" })).toBeDefined();
  });

  it("sets one up with exactly the fields its cadence uses, in the caller's name", async () => {
    const { calls, router } = open("member", "/schedules", (call) => {
      if (call.method === "POST") return json(201, { mission: mission({ id: "cm-new" }) });
      if (call.url.pathname === "/continuous-missions/cm-new") return json(200, { mission: detail({ id: "cm-new" }) });
      return json(200, { missions: [] });
    });

    await userEvent.click(await screen.findByRole("button", { name: /New schedule/ }));

    const form = screen.getByRole("form", { name: "New schedule" });
    await userEvent.type(within(form).getByPlaceholderText("Competitor pricing watch"), "Pricing watch");
    await userEvent.type(within(form).getByPlaceholderText(/Check our three main competitors/), "Check competitor prices weekly.");
    await userEvent.selectOptions(within(form).getByLabelText("How often"), "daily");

    const time = within(form).getByLabelText("At");
    await userEvent.clear(time);
    await userEvent.type(time, "18:15");

    await userEvent.click(within(form).getByRole("button", { name: "Start the schedule" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/schedules/cm-new"));

    const created = calls.find((call) => call.method === "POST" && call.url.pathname === "/continuous-missions")!;
    const body = created.body as Record<string, unknown>;

    expect(body.name).toBe("Pricing watch");
    expect(body.objective).toBe("Check competitor prices weekly.");
    expect(body).not.toHaveProperty("ownerId");
    expect(body.schedule).toEqual({ cadence: "daily", hour: 18, minute: 15, timezone: expect.any(String) });
  });

  it("shows the server's refusal when a schedule cannot be set up", async () => {
    open("member", "/schedules", (call) => call.method === "POST"
      ? json(409, { error: { code: "CONFLICT", message: "A continuous mission called \"Pricing watch\" already exists in this organization." } })
      : json(200, { missions: [] }));

    await userEvent.click(await screen.findByRole("button", { name: /New schedule/ }));
    const form = screen.getByRole("form", { name: "New schedule" });
    await userEvent.type(within(form).getByPlaceholderText("Competitor pricing watch"), "Pricing watch");
    await userEvent.type(within(form).getByPlaceholderText(/Check our three main competitors/), "Check prices.");
    await userEvent.click(within(form).getByRole("button", { name: "Start the schedule" }));

    expect(await within(form).findByText(/already exists in this organization/)).toBeDefined();
  });
});

describe("one schedule", () => {
  const runs: ContinuousMissionDetail["runs"] = [
    { sequence: 2, workId: "w2", trigger: "schedule", scheduledFor: anHourAgo, startedAt: anHourAgo, finishedAt: anHourAgo, state: "blocked", note: "No unattended calculations refused a step, so the run stopped there." },
    { sequence: 1, workId: "w1", trigger: "manual", scheduledFor: anHourAgo, startedAt: anHourAgo, finishedAt: anHourAgo, state: "completed_with_limitations" },
  ];

  it("shows every run's structured outcome, linked to its mission, and how many were skipped", async () => {
    open("member", "/schedules/cm-1", () => json(200, { mission: detail({ runs, runCount: 2, skipped: 1 }) }));

    const history = await screen.findByRole("list", { name: "Run history" });
    const [second, first] = within(history).getAllByRole("link");

    expect(second!.getAttribute("href")).toBe("/missions/w2");
    expect(within(second!).getByText("Blocked by a rule")).toBeDefined();
    expect(within(second!).getByText(/refused a step/)).toBeDefined();
    expect(within(first!).getByText("Completed with limitations")).toBeDefined();
    expect(within(first!).getByText(/started by hand/)).toBeDefined();
    expect(screen.getByText(/skipped rather than stacked up/)).toBeDefined();
  });

  it("keeps internal references under Technical details", async () => {
    open("member", "/schedules/cm-1", () => json(200, { mission: detail() }));

    const technical = (await screen.findByText("Technical details")).closest("details")!;
    expect(technical.open).toBe(false);
    expect(within(technical).getByText("cm-1")).toBeDefined();
  });

  it("lets a member pause, and resume, a schedule", async () => {
    let current = detail();
    const { calls } = open("member", "/schedules/cm-1", (call) => {
      if (call.method === "POST" && call.url.pathname.endsWith("/pause")) current = detail({ status: "paused", pauseReason: "person", nextRunAt: undefined });
      if (call.method === "POST" && call.url.pathname.endsWith("/resume")) current = detail();
      return json(200, { mission: current });
    });

    await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await userEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await screen.findByRole("button", { name: "Pause" });

    expect(calls.filter((call) => call.method === "POST").map((call) => call.url.pathname)).toEqual([
      "/continuous-missions/cm-1/pause",
      "/continuous-missions/cm-1/resume",
    ]);
  });

  it("asks once more before cancelling, and never with a browser dialog", async () => {
    let current = detail();
    const { calls } = open("owner", "/schedules/cm-1", (call) => {
      if (call.method === "POST") current = detail({ status: "cancelled", nextRunAt: undefined });
      return json(200, { mission: current });
    });

    await userEvent.click(await screen.findByRole("button", { name: "Cancel…" }));
    expect(calls.some((call) => call.method === "POST")).toBe(false);

    const confirm = screen.getByRole("group", { name: "Confirm cancelling the schedule" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel the schedule" }));

    await waitFor(() => expect(calls.some((call) => call.url.pathname.endsWith("/cancel"))).toBe(true));
    expect(await screen.findByText("Cancelled")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
  });

  it("does not offer a second run while one is still going", async () => {
    open("member", "/schedules/cm-1", () => json(200, {
      mission: detail({ runs: [{ sequence: 1, workId: "w1", trigger: "schedule", scheduledFor: anHourAgo, startedAt: anHourAgo, state: "waiting_for_approval" }] }),
    }));

    const run = await screen.findByRole("button", { name: "Run now" });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/still waiting for a decision/)).toBeDefined();
  });

  it("offers a viewer the record and no controls", async () => {
    open("viewer", "/schedules/cm-1", () => json(200, { mission: detail({ runs }) }));

    await screen.findByRole("list", { name: "Run history" });
    for (const name of ["Pause", "Resume", "Run now", "Cancel…"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("says why a schedule that stopped itself stopped", async () => {
    open("owner", "/schedules/cm-1", () => json(200, {
      mission: detail({
        status: "paused",
        pauseReason: "owner_access",
        pauseNote: "It stopped itself because the person it runs for can no longer start missions there.",
        nextRunAt: undefined,
      }),
    }));

    expect(await screen.findByText("It stopped itself")).toBeDefined();
    expect(screen.getByText(/can no longer start missions there/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Resume" })).toBeDefined();
  });

  it("reads a schedule out of reach as not here", async () => {
    open("member", "/schedules/cm-9", () => json(404, { error: { code: "NOT_FOUND", message: "Continuous mission not found." } }));

    expect(await screen.findByText("This schedule is not here")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
