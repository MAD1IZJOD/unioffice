import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { AttentionItem, CompanyReadiness, MissionCard, MissionControl } from "../lib/api";
import type { LiveResource } from "../lib/live";
import { deferred, json, stubNetwork, type RecordedCall } from "../test/network";
import Command from "./Command";

/**
 * The Command Center with the real API client; only the network answers are
 * scripted, in the shape GET /mission-control returns. What these check is
 * that the page answers "does anything need me" truthfully in every state -
 * loading, empty, broken, stale, busy - and that acting sends exactly what the
 * backend expects.
 */

const ORGANIZATION = "2f6b579a-f0f8-45a5-868a-21c08bde1314";
const iso = (minutesAgo = 0) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function view(overrides: Partial<MissionControl> = {}): MissionControl {
  return {
    organizationId: ORGANIZATION,
    generatedAt: iso(),
    summary: { running: 0, blocked: 0, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 0, total: 0 },
    running: [],
    blocked: [],
    finished: [],
    attention: { items: [], actionCount: 0, reviewCount: 0, watchCount: 0, total: 0 },
    outcomes: [],
    signals: { decisions: [], lessons: [], awaiting: { total: 0, atLeast: false, missions: [] }, conflicts: [] },
    workforce: { total: 0, active: 0, working: 0, unavailable: [], roster: [] },
    ...overrides,
  };
}

function card(id: string, overrides: Partial<MissionCard> = {}): MissionCard {
  return {
    id,
    objective: `Objective ${id}`,
    status: "executing",
    phase: "running",
    priority: "normal",
    stage: "Working on “Draft the review”",
    currentSteps: ["Draft the review"],
    progress: { total: 3, completed: 1, running: 1, failed: 0 },
    team: [{ agentId: "a1", name: "Harvey", state: "working" }],
    createdAt: iso(20),
    startedAt: iso(12),
    lastActivityAt: iso(1),
    elapsedMs: 12 * 60_000,
    acknowledged: false,
    latest: { text: "Harvey started “Draft the review”", at: iso(1) },
    ...overrides,
  };
}

function item(id: string, overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id,
    kind: "decision",
    severity: "action",
    level: "high",
    source: "approval",
    label: "Send the announcement",
    detail: "This contacts every customer.",
    consequence: "The mission is stopped here.",
    action: { label: "Review", path: "/missions/w-launch" },
    acknowledgeable: false,
    workId: "w-launch",
    objective: "Launch the campaign",
    at: iso(3),
    ...overrides,
  };
}

/**
 * Readiness, which the page reads only to ask whether this company has ever
 * been given a mission. The default is a company that has, so every test
 * about triage sees the page as it has always been.
 */
function readiness(overrides: Partial<CompanyReadiness["firstRun"]> = {}): CompanyReadiness {
  return {
    organizationId: ORGANIZATION,
    generatedAt: iso(),
    state: "ready",
    headline: "Your workforce is ready to work.",
    detail: "4 things the company knows how to do, and someone to do every one of them.",
    summary: { abilities: 4, ready: 4, blocked: 0, agents: 6, activeAgents: 6 },
    areas: [],
    firstRun: { pending: false, canPrepareWorkforce: true, canStartMission: true, ...overrides },
  };
}

function renderPage(
  route: (call: RecordedCall) => Response | Promise<Response>,
  company: CompanyReadiness = readiness(),
) {
  const calls = stubNetwork((call) =>
    call.url.pathname === "/company-readiness" ? json(200, company) : route(call));

  const router = createMemoryRouter(
    [
      { path: "/command", element: <Command /> },
      { path: "*", element: <p>Somewhere else</p> },
    ],
    { initialEntries: ["/command"] },
  );

  render(<RouterProvider router={router} />);
  return { calls, router };
}

const readsOf = (calls: RecordedCall[]) =>
  calls.filter((call) => call.method === "GET" && call.url.pathname === "/mission-control");

describe("the Command Center", () => {
  it("says it is reading while the first answer is on its way", async () => {
    const release = deferred<Response>();
    renderPage(() => release.promise);

    expect(screen.getByText("Reading the state of the company…")).toBeDefined();
    expect(document.querySelector("[aria-busy='true']")).not.toBeNull();

    release.resolve(json(200, view()));

    expect(await screen.findByText("Nothing needs you")).toBeDefined();
  });

  it("an empty company says so plainly and offers to start a mission", async () => {
    const { calls } = renderPage(() => json(200, view()));

    expect(await screen.findByText("NOTHING HAS")).toBeDefined();
    expect(screen.getByText("Nothing needs you")).toBeDefined();
    expect(screen.getByText("Nothing is running.")).toBeDefined();
    expect(screen.getByText("Nothing is blocked.")).toBeDefined();
    expect(screen.getByText("Nothing has finished yet.")).toBeDefined();
    // The header's primary action, and the empty Running section's own offer.
    const starts = screen.getAllByRole("link", { name: /Start mission/ });
    expect(starts).toHaveLength(2);
    expect(starts.every((link) => link.getAttribute("href") === "/missions/new")).toBe(true);
    expect(screen.getByRole("link", { name: "From a template" }).getAttribute("href")).toBe("/missions/new#templates");

    expect(readsOf(calls)[0]!.url.searchParams.get("organizationId")).toBe(ORGANIZATION);
  });

  it("leads a company that has never worked to its readiness rather than to an empty queue", async () => {
    renderPage(() => json(200, view()), readiness({ pending: true }));

    const welcome = await screen.findByRole("region", { name: "Getting started" });

    expect(within(welcome).getByText("Your company is ready for its first mission.")).toBeDefined();
    expect(within(welcome).getByRole("link", { name: /Start your first mission/ }).getAttribute("href"))
      .toBe("/missions/new");
    expect(within(welcome).getByRole("link", { name: /See what your company can do/ }).getAttribute("href"))
      .toBe("/readiness");
  });

  it("tells a company that is not ready yet to prepare before offering it a mission", async () => {
    const notReady: CompanyReadiness = {
      ...readiness({ pending: true }),
      state: "not_ready",
      headline: "Your workforce is not ready yet.",
      detail: "6 agents are working, but nothing the company knows how to do can be given to any of them yet.",
      summary: { abilities: 4, ready: 0, blocked: 4, agents: 6, activeAgents: 6 },
    };

    renderPage(() => json(200, view()), notReady);

    const welcome = await screen.findByRole("region", { name: "Getting started" });

    expect(within(welcome).getByText("Your company needs setting up before its first mission.")).toBeDefined();
    expect(within(welcome).queryByRole("link", { name: /Start your first mission/ })).toBeNull();
    expect(within(welcome).getByRole("link", { name: /See what your company can do/ })).toBeDefined();
  });

  it("never shows the first morning to a company that has already worked", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 0, needsYou: 0, finishedToday: 1, failedToday: 0, setAside: 0, total: 1 },
    })));

    await screen.findByText("Nothing needs you");
    expect(screen.queryByRole("region", { name: "Getting started" })).toBeNull();
  });

  it("does not ask about readiness at all once the company has missions", async () => {
    const { calls } = renderPage(() => json(200, view({
      summary: { running: 1, blocked: 0, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 0, total: 1 },
      running: [card("w1")],
    })));

    await screen.findByText("THE COMPANY");
    expect(calls.some((call) => call.url.pathname === "/company-readiness")).toBe(false);
  });

  it("when the read fails with nothing to show, it says so and can try again", async () => {
    let attempts = 0;
    renderPage(() => {
      attempts += 1;
      return attempts === 1
        ? json(500, { error: { code: "INTERNAL_ERROR", message: "An internal error occurred." } })
        : json(200, view());
    });

    expect(await screen.findByText("Mission Control could not be read")).toBeDefined();
    expect(screen.getByText(/UNIOFFICE couldn't complete that right now/)).toBeDefined();

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Nothing needs you")).toBeDefined();
  });

  it("puts what needs a person first, each with its action, apart from what only needs a look", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 2, needsYou: 2, finishedToday: 0, failedToday: 0, setAside: 0, total: 3 },
      attention: {
        items: [
          item("approval:1"),
          item("stalled:w-old", {
            kind: "stalled",
            source: "queue",
            label: "Stalled",
            detail: "On the queue for 3 hours; no worker has picked it up.",
            consequence: "Nothing will move this on its own.",
            action: { label: "Open mission", path: "/missions/w-old" },
            acknowledgeable: true,
            workId: "w-old",
            objective: "Old test mission",
          }),
          item("lessons:w-done", {
            kind: "lessons",
            severity: "review",
            level: "low",
            source: "knowledge",
            label: "2 lessons waiting for a decision",
            detail: "Revise pricing",
            objective: "Revise pricing",
            action: { label: "Decide", path: "/missions/w-done#debrief" },
            workId: "w-done",
          }),
        ],
        actionCount: 2,
        reviewCount: 1,
        watchCount: 0,
        total: 3,
      },
    })));

    expect(await screen.findByText("TWO THINGS")).toBeDefined();
    expect(screen.getByText("NEED YOU.")).toBeDefined();

    const needsYou = screen.getByRole("group", { name: "Needs you" });
    const decision = within(needsYou).getByRole("article", { name: "Send the announcement" });
    expect(within(decision).getByRole("link", { name: /Review/ }).getAttribute("href")).toBe("/missions/w-launch");
    expect(within(decision).queryByRole("button", { name: "Mark as seen" })).toBeNull();

    const stalled = within(needsYou).getByRole("article", { name: "Stalled" });
    expect(within(stalled).getByText("On the queue for 3 hours; no worker has picked it up.")).toBeDefined();
    expect(within(stalled).getByRole("button", { name: "Mark as seen" })).toBeDefined();

    const review = screen.getByRole("group", { name: /Worth a look/ });
    expect(within(review).getByRole("link", { name: /Decide/ }).getAttribute("href")).toBe("/missions/w-done#debrief");
  });

  it("marking a stalled mission as seen asks the server, then reads the company again", async () => {
    let seen = false;

    const { calls } = renderPage((call) => {
      if (call.method === "POST") {
        seen = true;
        return json(200, { workId: "w-old", acknowledgedAt: iso() });
      }

      return json(200, seen
        ? view({ summary: { running: 0, blocked: 0, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 1, total: 1 } })
        : view({
            summary: { running: 0, blocked: 1, needsYou: 1, finishedToday: 0, failedToday: 0, setAside: 0, total: 1 },
            attention: {
              items: [item("stalled:w-old", { kind: "stalled", label: "Stalled", acknowledgeable: true, workId: "w-old" })],
              actionCount: 1,
              reviewCount: 0,
              watchCount: 0,
              total: 1,
            },
          }));
    });

    await userEvent.setup().click(await screen.findByRole("button", { name: "Mark as seen" }));

    expect(await screen.findByText("Nothing needs you")).toBeDefined();
    expect(screen.getByText(/1 stalled mission was marked as seen and is set aside/)).toBeDefined();

    const post = calls.find((call) => call.method === "POST")!;
    expect(post.url.pathname).toBe("/work/w-old/acknowledge");
    expect(post.body).toEqual({ organizationId: ORGANIZATION });
    expect(readsOf(calls).length).toBe(2);
  });

  it("a refused mark-as-seen is explained on the entry, and the entry stays", async () => {
    renderPage((call) =>
      call.method === "POST"
        ? json(409, { error: { code: "CONFLICT", message: "This mission is on the queue and will move on its own." } })
        : json(200, view({
            attention: {
              items: [item("stalled:w-old", { kind: "stalled", label: "Stalled", acknowledgeable: true, workId: "w-old" })],
              actionCount: 1,
              reviewCount: 0,
              watchCount: 0,
              total: 1,
            },
          })));

    await userEvent.setup().click(await screen.findByRole("button", { name: "Mark as seen" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This mission is on the queue and will move on its own.");
    expect(screen.getByRole("article", { name: "Stalled" })).toBeDefined();
  });

  it("running and blocked missions say what they are on, who is on them and why they are stuck", async () => {
    renderPage(() => json(200, view({
      summary: { running: 1, blocked: 1, needsYou: 1, finishedToday: 1, failedToday: 0, setAside: 0, total: 3 },
      running: [card("w-review", { name: "Q3 burn review", objective: "Review our monthly burn against plan." })],
      blocked: [card("w-market", {
        objective: "Research the market",
        phase: "stalled",
        status: "queued",
        stage: "Stalled",
        team: [{ agentId: "a2", name: "Rhea", state: "unavailable" }],
        blocked: { kind: "agent_unavailable", reason: "“Interview customers” is assigned to Rhea, who is paused." },
        latest: undefined,
      })],
      finished: [card("w-done", {
        objective: "Write the board note",
        status: "failed",
        phase: "failed",
        stage: "Stopped",
        failure: "The local model was unavailable when this ran.",
        completedAt: iso(30),
      })],
    })));

    const running = (await screen.findByRole("heading", { name: /Running/ })).closest("section")!;
    const reviewRow = within(running).getByRole("article", { name: "Q3 burn review" });
    expect(within(reviewRow).getByRole("link", { name: "Q3 burn review" }).getAttribute("href")).toBe("/missions/w-review");
    expect(within(reviewRow).getByText("Review our monthly burn against plan.")).toBeDefined();
    expect(within(reviewRow).getByText("Working on “Draft the review”")).toBeDefined();
    // Each agent on the mission opens their own workforce profile.
    expect(within(reviewRow).getByRole("link", { name: "Harvey" }).getAttribute("href")).toBe("/workforce/a1");
    expect(within(reviewRow).getByText("1/3 steps")).toBeDefined();
    expect(within(reviewRow).getByText("12m so far")).toBeDefined();
    expect(within(reviewRow).getByText(/Harvey started “Draft the review”/)).toBeDefined();

    const blocked = screen.getByRole("heading", { name: /Blocked/ }).closest("section")!;
    expect(within(blocked).getByText("“Interview customers” is assigned to Rhea, who is paused.")).toBeDefined();
    expect(within(blocked).getByText("stalled")).toBeDefined();

    expect(screen.getByText("The local model was unavailable when this ran.")).toBeDefined();
  });

  it("what happened and what the company knows link to where each lives", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 0, needsYou: 0, finishedToday: 1, failedToday: 0, setAside: 0, total: 1 },
      outcomes: [
        { id: "o1", kind: "mission_completed", text: "Mission finished", detail: "Write the board note", note: "2 steps · 2 artifacts", path: "/missions/w-done", at: iso(5) },
        { id: "o2", kind: "knowledge", text: "Kept as company knowledge: “Launches need legal sign-off”", path: "/brain/k1", at: iso(2) },
      ],
      signals: {
        decisions: [{ id: "k1", title: "Starter stays at 99", type: "decision", status: "active", createdAt: iso(60) }],
        lessons: [],
        awaiting: { total: 2, atLeast: false, missions: [{ workId: "w-done", objective: "Revise pricing", count: 2 }] },
        conflicts: [{ id: "c1", reason: "Manual versus automated.", left: { id: "k2", title: "Sign-off is manual" }, right: { id: "k3", title: "Sign-off is automated" } }],
      },
    })));

    expect((await screen.findByRole("link", { name: "Mission finished" })).getAttribute("href")).toBe("/missions/w-done");
    expect(screen.getByText("2 steps · 2 artifacts")).toBeDefined();
    expect(screen.getByRole("link", { name: /Launches need legal sign-off/ }).getAttribute("href")).toBe("/brain/k1");

    const disagreement = screen.getByRole("group", { name: "Disagrees with itself" });
    expect(within(disagreement).getByRole("link").getAttribute("href")).toBe("/brain/k2");
    expect(screen.getByRole("link", { name: "2 from “Revise pricing”" }).getAttribute("href")).toBe("/missions/w-done#debrief");
    expect(screen.getByRole("link", { name: /Starter stays at 99/ }).getAttribute("href")).toBe("/brain/k1");
  });

  it("an old answer is labelled with its age", async () => {
    renderPage(() => json(200, view({ generatedAt: iso(5) })));

    const label = await screen.findByText("Updated 5m ago");
    expect(label.className).toContain("control-freshness-stale");
  });

  it("inside the shell it uses the shell's read and asks the network for nothing", async () => {
    const calls = stubNetwork(() => json(500, { error: { message: "should not be called" } }));
    const shared = {
      data: view({ summary: { running: 1, blocked: 0, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 0, total: 1 }, running: [card("w1")] }),
      error: undefined,
      loading: false,
      refreshing: false,
      reload: vi.fn(),
      live: true,
      status: "live",
      feed: [],
    } as LiveResource<MissionControl>;

    const router = createMemoryRouter(
      [{ path: "/", element: <Outlet context={{ missionControl: shared }} />, children: [{ path: "command", element: <Command /> }] }],
      { initialEntries: ["/command"] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText("THE COMPANY")).toBeDefined();
    await waitFor(() => expect(screen.getByText("Watching live")).toBeDefined());
    expect(calls).toHaveLength(0);
  });

  it("says what each agent is doing, busiest first, from the missions in flight", async () => {
    renderPage(() => json(200, view({
      summary: { running: 1, blocked: 1, needsYou: 1, finishedToday: 0, failedToday: 0, setAside: 0, total: 2 },
      running: [card("m1", { name: "Close the books", team: [{ agentId: "a1", name: "Harvey", state: "working" }] })],
      blocked: [card("m2", { name: "Hire an analyst", phase: "waiting_approval", team: [{ agentId: "a2", name: "Jamie", state: "waiting" }] })],
      workforce: {
        total: 4,
        active: 3,
        working: 1,
        unavailable: [{ agentId: "a4", name: "Peter", status: "paused" }],
        roster: [
          { agentId: "a3", name: "Mike", type: "specialist", status: "active", capabilities: [] },
          { agentId: "a4", name: "Peter", type: "specialist", status: "paused", capabilities: [] },
          { agentId: "a2", name: "Jamie", type: "specialist", status: "active", capabilities: [] },
          { agentId: "a1", name: "Harvey", type: "specialist", status: "active", capabilities: [] },
        ],
      },
    })));

    const agents = await screen.findByRole("list", { name: "Agents" });
    const rows = within(agents).getAllByRole("listitem");

    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual(["Harvey", "Jamie", "Mike", "Peter"]);
    expect(within(rows[0]!).getByText("Working")).toBeDefined();
    expect(within(rows[0]!).getByRole("link", { name: /Close the books/ })).toBeDefined();
    expect(within(rows[1]!).getByText("Waiting on a decision")).toBeDefined();
    expect(within(rows[2]!).getByText("Available")).toBeDefined();
    expect(within(rows[3]!).getByText("Paused")).toBeDefined();
  });
  /* ------------------------------------------------------------------------
     Entries that are not yours
     ------------------------------------------------------------------------ */

  it("shows an entry someone cannot act on as somebody else's, with no control offered", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 1, needsYou: 0, finishedToday: 0, failedToday: 0, setAside: 0, total: 1 },
      attention: {
        items: [
          item("approval:1", {
            actionable: false,
            handoff: "A policy stopped this step, so an owner or an admin decides it.",
          }),
        ],
        actionCount: 0,
        waitingOnOthersCount: 1,
        reviewCount: 0,
        watchCount: 0,
        total: 1,
      },
    })));

    const entry = await screen.findByRole("article", { name: "Send the announcement" });

    expect(within(entry).getByText(/an owner or an admin decides it/)).toBeDefined();
    expect(within(entry).queryByRole("link", { name: /Review/ })).toBeNull();
    expect(within(entry).getByRole("link", { name: /Look at it/ })).toBeDefined();
    expect(screen.getByRole("group", { name: "Stopped — waiting on someone else" })).toBeDefined();
    expect(screen.queryByRole("group", { name: "Needs you" })).toBeNull();
  });

  it("keeps what is yours and what is somebody else's in separate bands", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 2, needsYou: 1, finishedToday: 0, failedToday: 0, setAside: 0, total: 2 },
      attention: {
        items: [
          item("approval:mine"),
          item("conflict:theirs", {
            kind: "conflict",
            severity: "action",
            source: "knowledge",
            label: "Company knowledge disagrees",
            action: { label: "Settle it", path: "/brain/k1" },
            actionable: false,
            handoff: "An owner or an admin settles what the company knows.",
            workId: undefined,
          }),
        ],
        actionCount: 1,
        waitingOnOthersCount: 1,
        reviewCount: 0,
        watchCount: 0,
        total: 2,
      },
    })));

    const mine = await screen.findByRole("group", { name: "Needs you" });
    const theirs = screen.getByRole("group", { name: "Stopped — waiting on someone else" });

    expect(within(mine).getByRole("link", { name: /Review/ })).toBeDefined();
    expect(within(theirs).queryByRole("link", { name: /Settle it/ })).toBeNull();
    // Nothing to open either: this entry names no mission to look at.
    expect(within(theirs).getByText(/An owner or an admin settles/)).toBeDefined();
  });

  it("an API that has not been told about this yet still offers every action", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 1, needsYou: 1, finishedToday: 0, failedToday: 0, setAside: 0, total: 1 },
      attention: {
        items: [item("approval:1")],
        actionCount: 1,
        reviewCount: 0,
        watchCount: 0,
        total: 1,
      },
    })));

    const entry = await screen.findByRole("article", { name: "Send the announcement" });

    expect(within(entry).getByRole("link", { name: /Review/ })).toBeDefined();
  });
  it("names a setup problem as one, and sends the person where the fix is", async () => {
    renderPage(() => json(200, view({
      summary: { running: 0, blocked: 1, needsYou: 1, finishedToday: 0, failedToday: 1, setAside: 0, total: 1 },
      attention: {
        items: [
          item("configuration:w1", {
            kind: "configuration",
            source: "workforce",
            label: "Nobody is set up to use the calculator",
            detail: "No eligible agent is authorized for the required tool(s): calculator.",
            consequence: "Every mission needing this stops the same way. Grant it to an agent, then retry the mission.",
            action: { label: "Set up the workforce", path: "/workforce" },
            acknowledgeable: true,
            workId: "w1",
            objective: "Work out the quarterly burn",
          }),
        ],
        actionCount: 1,
        waitingOnOthersCount: 0,
        reviewCount: 0,
        watchCount: 0,
        total: 1,
      },
    })));

    const entry = await screen.findByRole("article", { name: "Nobody is set up to use the calculator" });

    expect(within(entry).getByRole("link", { name: /Set up the workforce/ })).toHaveProperty(
      "pathname",
      "/workforce",
    );
    expect(within(entry).getByText(/Grant it to an agent, then retry/)).toBeDefined();
  });
});
