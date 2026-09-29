import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrganizationRole, WorldAgent, WorldHandoff, WorldSnapshot } from "../lib/api";
import { AccessContext } from "../lib/access";
import { planFloor } from "../world/layout";
import { FIGURE_WIDTH } from "../world/sprites";

import { signedInAs } from "../test/access";
import { deferred, json, stubNetwork } from "../test/network";
import World from "./World";

/**
 * The world page over the real client, with only the network scripted.
 *
 * What these hold it to: it shows what the server said and nothing more -
 * an empty room is empty, an agent busy on a mission the viewer cannot open
 * is not told on what - every action is a link into the page that owns it,
 * offered only to a role that could use it, and opening the page replays
 * nothing.
 */

function agent(id: string, overrides: Partial<WorldAgent> = {}): WorldAgent {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    type: "specialist",
    status: "active",
    presence: "available",
    capabilities: ["coding"],
    roomId: "hall",
    seat: 0,
    workingElsewhere: false,
    upcomingSteps: 0,
    planningElsewhere: false,
    ...overrides,
  };
}

function snapshot(): WorldSnapshot {
  return {
    organizationId: "org",
    generatedAt: new Date().toISOString(),
    rooms: [
      { id: "hall", kind: "hall", name: "Company hall", agentIds: ["tyrion", "mike"] },
      { id: "eng", kind: "workspace", name: "Engineering", slug: "engineering", agentIds: ["tony"] },
      { id: "ops", kind: "workspace", name: "Operations", slug: "operations", agentIds: [] },
    ],
    agents: [
      agent("tyrion", { type: "orchestrator", capabilities: ["planning"] }),
      agent("mike", { seat: 1, capabilities: ["research"], presence: "working", workingElsewhere: true }),
      agent("tony", {
        roomId: "eng",
        presence: "waiting",
        current: { missionId: "launch", missionName: "Launch", taskTitle: "Ship the build", state: "waiting" },
      }),
    ],
    missions: [{ id: "launch", name: "Launch", status: "waiting_approval", workspaceId: "eng", agentIds: ["tony"], steps: 2, completedSteps: 1 }],
    handoffs: [
      {
        from: { id: "mike", name: "Mike" },
        to: { id: "tony", name: "Tony" },
        fromStep: { number: 1, title: "Research it" },
        toStep: { number: 2, title: "Ship the build" },
        state: "waiting",
        sentence: "Mike finished “Research it”. Tony is held until someone decides.",
        at: new Date().toISOString(),
        missionId: "launch",
        missionName: "Launch",
      },
    ],
  };
}

function open(role: OrganizationRole = "owner", data: WorldSnapshot = snapshot()) {
  const calls = stubNetwork((call) =>
    call.url.pathname.endsWith("/world") ? json(200, data) : json(404, { error: { message: "Not here." } }));

  page(role);
  return calls;
}

function page(role: OrganizationRole = "owner", path = "/world") {
  const router = createMemoryRouter(
    [
      {
        path: "/world",
        element: (
          <AccessContext.Provider value={signedInAs(role)}>
            <World />
          </AccessContext.Provider>
        ),
      },
      { path: "*", element: <p>Somewhere else</p> },
    ],
    { initialEntries: [path] },
  );

  return render(<RouterProvider router={router} />);
}

async function asList() {
  await userEvent.click(await screen.findByRole("button", { name: "List" }));
}

describe("the world", () => {
  it("counts only what the server reported", async () => {
    open();

    expect(await screen.findByText(/3 agents in 3 rooms/)).toBeDefined();
    expect(screen.getByText(/1 working/)).toBeDefined();
    expect(screen.getByText(/1 waiting on a decision/)).toBeDefined();
    expect(screen.getByText(/1 handoff in play/)).toBeDefined();
  });

  it("keeps an empty room honestly empty", async () => {
    open();
    await asList();

    const operations = screen.getByRole("region", { name: "Operations" });
    expect(within(operations).getByText("Nobody works here.")).toBeDefined();
  });

  it("says someone is working without saying on what, when the viewer cannot open it", async () => {
    open();
    await asList();

    expect(screen.getByText("Working on a mission you cannot open.")).toBeDefined();
  });

  it("offers the decision to a role that can make it, and the mission's own record", async () => {
    open("owner");
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Tony" });
    expect(within(details).getByText("Held on “Ship the build” until someone decides.")).toBeDefined();
    expect(within(details).getByRole("link", { name: /Review the decision/ }).getAttribute("href")).toBe("/approvals");
    expect(within(details).getByRole("link", { name: /Open the mission/ }).getAttribute("href")).toBe("/missions/launch");
    expect(within(details).getByRole("link", { name: "Open profile" }).getAttribute("href")).toBe("/workforce/tony");
  });

  it("offers a viewer the record and not the decision", async () => {
    open("viewer");
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Tony" });
    expect(within(details).queryByRole("link", { name: /Review the decision/ })).toBeNull();
    expect(within(details).getByText("Your role can follow this decision but not make it.")).toBeDefined();
  });

  it("explains a handoff as what the mission recorded, and links to that record", async () => {
    open();
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Mike → Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Work changing hands" });
    expect(within(details).getByText("Mike finished “Research it”. Tony is held until someone decides.")).toBeDefined();
    expect(within(details).getByText(/Nobody met/)).toBeDefined();
    expect(within(details).getByRole("link", { name: /Open the mission record/ }).getAttribute("href")).toBe("/missions/launch");
  });

  it("names the result a handoff delivered and opens it in the mission's own room", async () => {
    const data = snapshot();
    data.handoffs[0]!.delivered = { artifactId: "result-1", name: "Market notes" };
    open("owner", data);
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Mike → Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Work changing hands" });
    expect(within(details).getByText("Market notes")).toBeDefined();
    expect(within(details).getByRole("link", { name: /Open the result/ }).getAttribute("href"))
      .toBe("/missions/launch?artifact=result-1");
  });

  it("offers no result to open when the step stored none", async () => {
    open();
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Mike → Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Work changing hands" });
    expect(within(details).queryByRole("link", { name: /Open the result/ })).toBeNull();
  });

  it("finds an agent by name, says what was found, and opens it when picked", async () => {
    open();
    const search = await screen.findByRole("searchbox", { name: "Find in the office" });

    await userEvent.type(search, "TON");
    const matches = screen.getByRole("list", { name: "Matches" });
    const hit = within(matches).getByRole("button", { name: /^Agent Tony/ });

    await userEvent.click(hit);
    expect(screen.getByRole("complementary", { name: "Details: Tony" })).toBeDefined();
    expect(screen.queryByRole("list", { name: "Matches" })).toBeNull();
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("finds the step someone is on and a result that changed hands, and picks the first with Enter", async () => {
    const data = snapshot();
    data.handoffs[0]!.delivered = { artifactId: "result-1", name: "Market notes" };
    open("owner", data);
    const search = await screen.findByRole("searchbox", { name: "Find in the office" });

    await userEvent.type(search, "ship the");
    expect(within(screen.getByRole("list", { name: "Matches" })).getAllByRole("button")[0]!.textContent).toMatch(/^Agent Tony/);

    await userEvent.clear(search);
    await userEvent.type(search, "market{Enter}");
    expect(screen.getByRole("complementary", { name: "Details: Work changing hands" })).toBeDefined();
  });

  it("says plainly when nothing matches, and Escape clears the search", async () => {
    open();
    const search = await screen.findByRole("searchbox", { name: "Find in the office" });

    await userEvent.type(search, "dana");
    expect(screen.getByRole("status").textContent).toBe("Nothing in the office matches “dana”.");

    await userEvent.keyboard("{Escape}");
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/Nothing in the office matches/)).toBeNull();
  });

  it("shows only the agents in a state, with how many are in each", async () => {
    open();
    await asList();

    await userEvent.click(screen.getByRole("button", { name: "Waiting on a decision 1" }));

    expect(screen.getByRole("status").textContent).toBe("Showing 1 of 3 agents.");
    expect(within(screen.getByRole("region", { name: "Engineering" })).getByRole("button", { name: "Tony" })).toBeDefined();
    expect(within(screen.getByRole("region", { name: "Company hall" })).getByText("Nobody here is in that state.")).toBeDefined();
  });

  it("keeps agents in any of several states, and Everyone brings the rest back", async () => {
    open();
    await asList();

    await userEvent.click(screen.getByRole("button", { name: "Working 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Waiting on a decision 1" }));

    expect(screen.getByRole("status").textContent).toBe("Showing 2 of 3 agents.");
    const hall = screen.getByRole("region", { name: "Company hall" });
    expect(within(hall).getByRole("button", { name: "Mike" })).toBeDefined();
    expect(within(hall).queryByRole("button", { name: "Tyrion" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Everyone 3" }));
    expect(screen.getByRole("button", { name: "Everyone 3" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(hall).getByRole("button", { name: "Tyrion" })).toBeDefined();
    expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
  });

  it("says so when nobody is in a state, rather than showing an empty office as though it were real", async () => {
    open();
    await asList();

    await userEvent.click(screen.getByRole("button", { name: "Writing a plan 0" }));

    expect(screen.getByRole("status").textContent).toBe("Nobody is in that state right now.");
    expect(within(screen.getByRole("region", { name: "Engineering" })).getByText("Nobody here is in that state.")).toBeDefined();
  });

  it("quietens the desks a filter leaves out on the map, and draws every one of them", async () => {
    // The map is only drawn once its stage has a size, which jsdom never lays out.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });

    try {
      stubNetwork((call) => (call.url.pathname.endsWith("/world") ? json(200, snapshot()) : json(404, { error: { message: "Not here." } })));
      const { container } = page();
      await waitFor(() => expect(container.querySelectorAll(".world-desk")).toHaveLength(3));

      await userEvent.click(screen.getByRole("button", { name: "Waiting on a decision 1" }));

      const faded = [...container.querySelectorAll(".world-desk")]
        .map((desk) => [desk.querySelector(".world-name")?.textContent, desk.classList.contains("world-desk-faded")]);
      expect(Object.fromEntries(faded)).toEqual({ Tyrion: true, Mike: true, Tony: false });
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });

  it("shows an agent's tools and skills from their profile, by name, without internal ids", async () => {
    const profile = {
      governance: {
        tools: [
          { toolId: "tool-7f3a9c", name: "Deploy", access: "requires_approval", risk: "high", policyNames: [], explanation: "" },
          { toolId: "tool-02bd41", name: "Read the repository", access: "allowed", risk: "low", policyNames: [], explanation: "" },
        ],
        policies: [],
      },
      skills: [{ slug: "release-notes", name: "Release notes", category: null, scope: null, approval: null, usable: true, note: "" }],
    };
    const calls = stubNetwork((call) =>
      call.url.pathname.endsWith("/world") ? json(200, snapshot())
        : call.url.pathname.endsWith("/workforce/tony") ? json(200, profile)
          : json(404, { error: { message: "Not here." } }));
    page();
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Tony" });
    const tools = await within(details).findByRole("list", { name: "Tools" });
    expect(within(tools).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["DeployNeeds approval", "Read the repositoryAllowed"]);
    expect(within(within(details).getByRole("list", { name: "Skills" })).getByText("Release notes")).toBeDefined();
    expect(details.textContent).not.toMatch(/tool-7f3a9c|tool-02bd41|release-notes/);

    // The same read as the profile page, for this agent only.
    expect(calls.filter((call) => call.url.pathname.includes("/workforce/")).map((call) => call.url.pathname.split("/").at(-1))).toEqual(["tony"]);
  });

  it("says so when an agent's tools cannot be read, and shows nothing it does not know", async () => {
    open();
    await asList();
    await userEvent.click(screen.getByRole("button", { name: "Tony" }));

    const details = screen.getByRole("complementary", { name: "Details: Tony" });
    expect(await within(details).findByText("Tools and skills could not be read. The profile has them.")).toBeDefined();
    expect(within(details).queryByRole("list", { name: "Tools" })).toBeNull();
  });

  it("brings a chosen room or agent into view, says what the room is doing, and Fit shows the whole office again", async () => {
    // The map is only drawn once its stage has a size, which jsdom never lays out.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });

    try {
      stubNetwork((call) => (call.url.pathname.endsWith("/world") ? json(200, snapshot()) : json(404, { error: { message: "Not here." } })));
      const { container } = page();
      await waitFor(() => expect(container.querySelectorAll(".world-desk")).toHaveLength(3));

      const plan = planFloor(snapshot().rooms.map((room) => ({ id: room.id, agentIds: room.agentIds })));
      const view = () => {
        const [, x, y, k] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/
          .exec(container.querySelector(".world-svg > g")!.getAttribute("transform")!)!.map(Number);
        return { x: x!, y: y!, k: k! };
      };
      const centreOf = (point: { x: number; y: number }) => {
        const camera = view();
        return { x: camera.x + point.x * camera.k, y: camera.y + point.y * camera.k };
      };

      // A room, chosen on the map: centred, and its people and what they are doing.
      await userEvent.click(screen.getByRole("button", { name: "Engineering. 1 agent." }));
      const room = plan.rooms.find((entry) => entry.id === "eng")!.rect;
      const middle = centreOf({ x: room.x + room.width / 2, y: room.y + room.height / 2 });
      expect(middle.x).toBeCloseTo(600);
      expect(middle.y).toBeCloseTo(400);

      const details = screen.getByRole("complementary", { name: "Details: Engineering" });
      expect(within(details).getByText("Held on “Ship the build” until someone decides.")).toBeDefined();

      // Someone in it, chosen from the details: now they are in the middle.
      await userEvent.click(within(details).getByRole("button", { name: "Tony" }));
      const tony = centreOf(plan.seats.get("tony")!.at);
      expect(tony.x).toBeCloseTo(600);
      expect(tony.y).toBeCloseTo(400);

      // And back to the whole office.
      await userEvent.click(screen.getByRole("button", { name: "Fit the whole office" }));
      expect(view().k).toBeCloseTo(Math.min(1200 / plan.width, 800 / plan.height));
    } finally {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
    }
  });

  describe("opened on one mission", () => {
    function openAt(path: string, data: WorldSnapshot = snapshot()) {
      const calls = stubNetwork((call) =>
        call.url.pathname.endsWith("/world") ? json(200, data) : json(404, { error: { message: "Not here." } }));
      const view = page("owner", path);
      return { calls, ...view };
    }

    it("chooses the mission, says so, and leaves out only who is not on it", async () => {
      openAt("/world?mission=launch");

      expect(await screen.findByText(/Showing “Launch”\./)).toBeDefined();
      expect(screen.getByRole("complementary", { name: "Details: Launch" })).toBeDefined();

      await asList();
      expect(within(screen.getByRole("region", { name: "Engineering" })).getByRole("button", { name: "Tony" })).toBeDefined();
      expect(within(screen.getByRole("region", { name: "Company hall" })).getByText("Nobody here is on this mission.")).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Show the whole office" }));
      expect(screen.queryByText(/Showing “Launch”/)).toBeNull();
      expect(within(screen.getByRole("region", { name: "Company hall" })).getByRole("button", { name: "Tyrion" })).toBeDefined();
    });

    it("brings every agent on a mission into view together, and quietens nobody on it", async () => {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
      Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });

      try {
        const data = snapshot();
        data.missions[0]!.agentIds = ["mike", "tony"];
        const { container } = openAt("/world?mission=launch", data);
        await waitFor(() => expect(container.querySelectorAll(".world-desk")).toHaveLength(3));

        const faded = [...container.querySelectorAll(".world-desk")]
          .map((desk) => [desk.querySelector(".world-name")?.textContent, desk.classList.contains("world-desk-faded")]);
        expect(Object.fromEntries(faded)).toEqual({ Tyrion: true, Mike: false, Tony: false });

        const plan = planFloor(data.rooms.map((room) => ({ id: room.id, agentIds: room.agentIds })));
        const [, x, y, k] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/
          .exec(container.querySelector(".world-svg > g")!.getAttribute("transform")!)!.map(Number);
        for (const id of ["mike", "tony"]) {
          const at = plan.seats.get(id)!.at;
          const onStage = { x: x! + at.x * k!, y: y! + at.y * k! };
          expect(onStage.x).toBeGreaterThanOrEqual(0);
          expect(onStage.x).toBeLessThanOrEqual(1200);
          expect(onStage.y).toBeGreaterThanOrEqual(0);
          expect(onStage.y).toBeLessThanOrEqual(800);
        }
      } finally {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
        delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
      }
    });

    it("shows the whole office, with one plain note, for a mission not in view", async () => {
      openAt("/world?mission=no-such-mission");

      expect(await screen.findByText(/That mission is not under way in your view of the company/)).toBeDefined();
      expect(screen.queryByRole("complementary")).toBeNull();

      await asList();
      expect(within(screen.getByRole("region", { name: "Company hall" })).getByRole("button", { name: "Tyrion" })).toBeDefined();

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText(/not under way in your view/)).toBeNull();
    });

    it("tells another company's mission apart from a missing one by nothing, and asks nobody about it", async () => {
      const foreign = "7d1c2a9e-0b44-4f7e-9d61-2f6a3c8b5e10";
      const { calls } = openAt(`/world?mission=${foreign}`);

      const note = await screen.findByText(/That mission is not under way in your view of the company/);
      expect(note.textContent).toBe("That mission is not under way in your view of the company, so the whole office is shown. Dismiss");
      expect(calls.every((call) => call.url.pathname.endsWith("/world"))).toBe(true);
      expect(calls.some((call) => call.url.href.includes(foreign))).toBe(false);
    });

    it("opens as usual without one", async () => {
      openAt("/world");

      expect(await screen.findByText(/3 agents in 3 rooms/)).toBeDefined();
      expect(screen.queryByText(/Showing “/)).toBeNull();
      expect(screen.queryByText(/not under way in your view/)).toBeNull();
      expect(screen.queryByRole("complementary")).toBeNull();
    });
  });

  it("replays nothing on opening: the office is shown as it is", async () => {
    open();

    expect(await screen.findByText(/Nothing has changed since you opened the office/)).toBeDefined();
  });

  it("draws nobody when nobody works here", async () => {
    open("owner", { ...snapshot(), rooms: [{ id: "hall", kind: "hall", name: "Company hall", agentIds: [] }], agents: [], missions: [], handoffs: [] });

    expect(await screen.findByText("Nobody works here yet.")).toBeDefined();
  });
});

/**
 * Work changing hands, told on the map as it is watched.
 *
 * The page is connected over a scripted live channel and reads the office
 * twice: before a step finished, and after. Nothing else is told to it. The
 * animation clock is stepped by hand, frame by frame, and each frame is
 * recorded as it would be seen - so these hold the office to what someone
 * watching it sees, not to how the walk is worked out.
 */
describe("the world, watched as work changes hands", () => {
  const BEFORE = "2026-09-29T10:00:00.000Z";
  const AFTER = "2026-09-29T10:00:05.000Z";

  function office(generatedAt: string, handoffs: WorldHandoff[] = []): WorldSnapshot {
    const finished = handoffs.length > 0;

    return {
      organizationId: "org",
      generatedAt,
      rooms: [
        { id: "hall", kind: "hall", name: "Company hall", agentIds: ["tyrion", "mike"] },
        { id: "eng", kind: "workspace", name: "Engineering", slug: "engineering", agentIds: ["tony", "dana"] },
      ],
      agents: [
        agent("tyrion", { type: "orchestrator", capabilities: ["planning"] }),
        finished
          ? agent("mike", {
              seat: 1,
              capabilities: ["research"],
              lastOutcome: { missionId: "launch", missionName: "Launch", taskTitle: "Research it", outcome: "completed", at: AFTER },
            })
          : agent("mike", {
              seat: 1,
              capabilities: ["research"],
              presence: "working",
              current: { missionId: "launch", missionName: "Launch", taskTitle: "Research it", state: "working" },
            }),
        agent("tony", { roomId: "eng" }),
        agent("dana", { roomId: "eng", seat: 1, capabilities: ["design"] }),
      ],
      missions: [{ id: "launch", name: "Launch", status: "executing", workspaceId: "eng", agentIds: ["mike", "tony", "dana"], steps: 3, completedSteps: finished ? 1 : 0 }],
      handoffs,
    };
  }

  const passedTo = (id: string, name: string, step: number): WorldHandoff => ({
    from: { id: "mike", name: "Mike" },
    to: { id, name },
    fromStep: { number: 1, title: "Research it" },
    toStep: { number: step, title: `Step ${step}` },
    state: "in_progress",
    sentence: `Mike finished “Research it”. ${name} is using it.`,
    at: AFTER,
    missionId: "launch",
    missionName: "Launch",
  });

  // Where each desk is, from the same floor plan the page draws.
  const seats = planFloor(office(BEFORE).rooms.map((room) => ({ id: room.id, agentIds: room.agentIds }))).seats;
  const seatOf = (id: string) => seats.get(id)!.at;

  /** The live channel, scripted: the page opens it, the test says what arrives. */
  class ScriptedChannel extends EventTarget {
    static readonly CLOSED = 2;
    /** Every channel the page opened, across tests: a closing one lingers briefly and may be joined again. */
    static opened: ScriptedChannel[] = [];

    readonly url: string;
    readyState = 1;
    onerror: (() => void) | null = null;

    constructor(url: string) {
      super();
      this.url = url;
      ScriptedChannel.opened.push(this);
    }

    close() {
      this.readyState = ScriptedChannel.CLOSED;
    }
  }

  /* The animation clock, stepped by hand ------------------------------------ */
  let clock = 0;
  let scheduled = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;

  function frameAt(now: number) {
    act(() => {
      clock = now;
      const due = [...scheduled.values()];
      scheduled = new Map();
      due.forEach((callback) => callback(now));
    });
  }

  beforeEach(() => {
    clock = 0;
    scheduled = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame += 1;
      scheduled.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
    vi.spyOn(performance, "now").mockImplementation(() => clock);

    // The map is only drawn once its stage has a size, which jsdom never lays out.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 800 });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  });

  /** Opens the office live on its first reading; `deliver` is the next one. */
  async function watch(first: WorldSnapshot) {
    let latest = first;
    let reads = 0;
    const firstRead = deferred<Response>();

    stubNetwork((call) => {
      if (call.url.pathname.endsWith("/stream/tickets")) return json(200, { ticket: "ticket", expiresAt: AFTER });
      if (!call.url.pathname.endsWith("/world")) return json(404, { error: { message: "Not here." } });

      reads += 1;
      return reads === 1 ? firstRead.promise : json(200, latest);
    });
    vi.stubGlobal("EventSource", ScriptedChannel);

    const { container } = page();

    // The first reading is held until the channel is open, so it and the
    // next are two live readings in a row - the only kind the page tells.
    const channel = await waitFor(() => {
      const open = ScriptedChannel.opened.at(-1);
      if (!open || open.readyState === ScriptedChannel.CLOSED) throw new Error("The channel is not open yet.");
      return open;
    });
    act(() => {
      channel.dispatchEvent(new Event("open"));
    });
    await act(async () => firstRead.resolve(json(200, first)));
    await waitFor(() => expect(container.querySelector(".world-desk")).not.toBeNull());

    return {
      container,
      async deliver(next: WorldSnapshot) {
        latest = next;
        const before = reads;
        act(() => {
          channel.dispatchEvent(new MessageEvent("activity", { data: JSON.stringify({ events: [{ id: "event" }] }) }));
        });
        await waitFor(() => expect(reads).toBe(before + 1));
      },
    };
  }

  /* What someone watching sees, one frame at a time ------------------------- */
  const deskOf = (container: HTMLElement, name: string) =>
    [...container.querySelectorAll(".world-desk")].find((desk) => desk.querySelector(".world-name")?.textContent === name)!;

  /** Whether their figure is drawn in the chair - what the eye sees, not a class. */
  const seated = (container: HTMLElement, name: string) => deskOf(container, name).querySelector(".world-figure") !== null;

  interface Seen {
    /** Every figure of Mike on the map: at the desk and on the floor. */
    mikes: number;
    mikeSeated: boolean;
    /** Where the walking Mike's feet are, and whether the result is in hand. */
    walker?: { x: number; y: number; carrying: boolean };
    /** Anyone else on the floor, or out of their chair. */
    othersMoved: boolean;
  }

  function whereIs(walker: Element): NonNullable<Seen["walker"]> {
    const [, x, y, facing] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) 1\)/.exec(walker.getAttribute("transform")!)!.map(Number);
    const parcel = walker.querySelector(".world-parcel-sprite")!.parentElement!;
    return { x: x! + (facing! * FIGURE_WIDTH) / 2, y: y!, carrying: parcel.getAttribute("display") !== "none" };
  }

  function see(container: HTMLElement): Seen {
    const walkers = [...container.querySelectorAll<SVGGElement>('.world-traveller[data-walker="mike"]')];
    const shown = walkers.find((walker) => walker.getAttribute("opacity") === "1");
    const mikeSeated = seated(container, "Mike");

    const walker = shown ? whereIs(shown) : undefined;
    const strangers = container.querySelectorAll('.world-traveller:not([data-walker="mike"])').length;
    const othersMoved = strangers > 0 || !["Tony", "Dana", "Tyrion"].every((name) => seated(container, name));

    return { mikes: walkers.length + (mikeSeated ? 1 : 0), mikeSeated, walker, othersMoved };
  }

  /** Steps the clock a fiftieth of a second at a time until nobody is walking, recording each frame. */
  function watchFrames(container: HTMLElement): Seen[] {
    const frames: Seen[] = [];

    for (let now = 0; now <= 60_000; now += 20) {
      frameAt(now);
      const seen = see(container);
      frames.push(seen);
      if (container.querySelectorAll(".world-traveller").length === 0) return frames;
    }

    throw new Error("Still walking after a minute.");
  }

  // Feet are drawn a fixed height above the point walked, so a desk is
  // matched by x exactly and by y against where the walk began.
  const distance = (walker: { x: number; y: number }, seat: { x: number; y: number }, lift: number) =>
    Math.hypot(walker.x - seat.x, walker.y + lift - seat.y);

  it("walks the result from the finishing agent's empty chair to the next desk, and back", async () => {
    const { container, deliver } = await watch(office(BEFORE));
    const desks = new Map(["Tony", "Dana", "Tyrion"].map((name) => [name, deskOf(container, name).getAttribute("transform")]));
    expect(seated(container, "Mike")).toBe(true);

    await deliver(office(AFTER, [passedTo("tony", "Tony", 2)]));
    await waitFor(() => expect(container.querySelector('[data-walker="mike"]')).not.toBeNull());

    const frames = watchFrames(container);
    const walking = frames.filter((frame) => frame.walker !== undefined);
    const lift = seatOf("mike").y - walking[0]!.walker!.y;

    // Off from Mike's own desk, result in hand, and the chair left empty.
    expect(distance(walking[0]!.walker!, seatOf("mike"), lift)).toBeLessThan(2);
    expect(walking[0]!.walker!.carrying).toBe(true);
    expect(walking.every((frame) => !frame.mikeSeated && frame.mikes === 1)).toBe(true);

    // Carried all the way to Tony's desk, set down there, and not picked up again.
    const handedOver = walking.findIndex((frame) => !frame.walker!.carrying);
    expect(handedOver).toBeGreaterThan(0);
    expect(distance(walking[handedOver - 1]!.walker!, seatOf("tony"), lift)).toBeLessThan(2);
    expect(distance(walking[handedOver]!.walker!, seatOf("tony"), lift)).toBeLessThan(0.5);
    expect(walking.slice(handedOver).every((frame) => !frame.walker!.carrying)).toBe(true);

    // Back at Mike's desk, empty-handed, and sitting down again.
    expect(distance(walking.at(-1)!.walker!, seatOf("mike"), lift)).toBeLessThan(2);
    const last = frames.at(-1)!;
    expect(last.walker).toBeUndefined();
    expect(last.mikeSeated).toBe(true);
    expect(last.mikes).toBe(1);

    // Nobody else left their chair or went anywhere, at any moment.
    expect(frames.every((frame) => !frame.othersMoved)).toBe(true);
    for (const [name, transform] of desks) expect(deskOf(container, name).getAttribute("transform")).toBe(transform);
  });

  it("never draws one agent twice when one result feeds two steps: the walks are made one after the other", async () => {
    const { container, deliver } = await watch(office(BEFORE));

    await deliver(office(AFTER, [passedTo("tony", "Tony", 2), passedTo("dana", "Dana", 3)]));
    await waitFor(() => expect(container.querySelector('[data-walker="mike"]')).not.toBeNull());

    const frames = watchFrames(container);
    const walking = frames.filter((frame) => frame.walker !== undefined);
    const lift = seatOf("mike").y - walking[0]!.walker!.y;

    expect(frames.every((frame) => frame.mikes === 1)).toBe(true);
    expect(walking.every((frame) => !frame.mikeSeated)).toBe(true);

    // Where each result was set down: the frames it stops being carried.
    // (The way to Tony passes Dana's desk, so merely passing a desk proves nothing.)
    const setDown = walking.filter((frame, index) => index > 0 && walking[index - 1]!.walker!.carrying && !frame.walker!.carrying);
    expect(setDown).toHaveLength(2);
    expect(distance(setDown[0]!.walker!, seatOf("tony"), lift)).toBeLessThan(0.5);
    expect(distance(setDown[1]!.walker!, seatOf("dana"), lift)).toBeLessThan(0.5);

    expect(frames.at(-1)!.mikeSeated).toBe(true);
    expect(frames.every((frame) => !frame.othersMoved)).toBe(true);
  });

  it("carries a walk under way to its end when a burst of other handoffs arrives", async () => {
    const LATER = "2026-09-29T10:00:10.000Z";
    const helpers = ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"];
    const crowd = (generatedAt: string, handoffs: WorldHandoff[]): WorldSnapshot => {
      const base = office(generatedAt, handoffs);
      return {
        ...base,
        rooms: base.rooms.map((room) => (room.id === "hall" ? { ...room, agentIds: [...room.agentIds, ...helpers] } : room)),
        agents: [...base.agents, ...helpers.map((id, index) => agent(id, { seat: index + 2 }))],
      };
    };
    const crowdSeats = planFloor(crowd(BEFORE, []).rooms.map((room) => ({ id: room.id, agentIds: room.agentIds }))).seats;
    const toTony = passedTo("tony", "Tony", 2);
    const burst = helpers.map((id, index): WorldHandoff => ({
      ...passedTo("dana", "Dana", 30 + index),
      from: { id, name: id.toUpperCase() },
      fromStep: { number: 10 + index, title: `Part ${index + 1}` },
    }));

    const { container, deliver } = await watch(crowd(BEFORE, []));
    await deliver(crowd(AFTER, [toTony]));
    await waitFor(() => expect(container.querySelector('[data-walker="mike"]')).not.toBeNull());

    // Mike sets off with the result and is part of the way to Tony's desk.
    frameAt(0);
    const lift = crowdSeats.get("mike")!.at.y - see(container).walker!.y;
    for (let now = 20; now <= 600; now += 20) frameAt(now);
    const midway = see(container).walker;
    expect(midway?.carrying).toBe(true);

    // Eight more results change hands at once: nine trips, none of them dropped.
    await deliver(crowd(LATER, [toTony, ...burst]));
    await waitFor(() => expect(container.querySelectorAll(".world-traveller")).toHaveLength(9));

    // Mike has not snapped back, nor started over: same place, result still in hand.
    expect(see(container).walker).toEqual(midway);
    expect(seated(container, "Mike")).toBe(false);

    // Each desk is looked up once: the map keeps drawing the same ones.
    const everyone = [["mike", "Mike"], ...helpers.map((id) => [id, id.toUpperCase()])] as const;
    const desks = everyone.map(([id, name]) => [id, deskOf(container, name)] as const);
    const walking: Array<NonNullable<Seen["walker"]>> = [];

    for (let now = 620; ; now += 20) {
      if (now > 60_000) throw new Error("Still walking after a minute.");
      frameAt(now);

      const travellers = [...container.querySelectorAll(".world-traveller")];
      if (travellers.length === 0) break;

      // One of everybody, at every moment: in the chair or on the floor.
      const figures = desks.map(([id, desk]) =>
        travellers.filter((traveller) => traveller.getAttribute("data-walker") === id).length +
        (desk.querySelector(".world-figure") ? 1 : 0));
      expect(figures).toEqual(everyone.map(() => 1));

      const mike = travellers.find((traveller) => traveller.getAttribute("data-walker") === "mike");
      if (mike) walking.push(whereIs(mike));
    }

    // Mike's own walk ran its whole course: set down at Tony's desk, then back.
    const setDown = walking.findIndex((frame, index) => index > 0 && walking[index - 1]!.carrying && !frame.carrying);
    expect(distance(walking[setDown]!, crowdSeats.get("tony")!.at, lift)).toBeLessThan(0.5);
    expect(distance(walking.at(-1)!, crowdSeats.get("mike")!.at, lift)).toBeLessThan(2);

    for (const [, name] of everyone) expect(seated(container, name)).toBe(true);
    // Nine walkers checked every frame is heavy under jsdom; a ceiling, not a wait.
  }, 15_000);

  it("does not replay queued walks late when the page could not draw for a while", async () => {
    const { container, deliver } = await watch(office(BEFORE));

    await deliver(office(AFTER, [passedTo("tony", "Tony", 2), passedTo("dana", "Dana", 3)]));
    await waitFor(() => expect(container.querySelector('[data-walker="mike"]')).not.toBeNull());

    frameAt(0);
    expect(see(container).walker?.carrying).toBe(true);

    // The tab was in the background for ten minutes, then looked at again.
    // Both walks are long over: they finish now, one frame each, rather
    // than the second one starting its whole walk ten minutes late.
    const back = 10 * 60_000;
    for (const now of [back, back + 20]) {
      frameAt(now);
      expect(see(container).mikes).toBe(1);
    }

    expect(container.querySelectorAll(".world-traveller")).toHaveLength(0);
    expect(seated(container, "Mike")).toBe(true);
  });

  it("tells the handoff but walks nobody when the viewer asked for reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));

    const { container, deliver } = await watch(office(BEFORE));
    expect(screen.getByRole("button", { name: "Motion off" }).getAttribute("aria-pressed")).toBe("false");

    await deliver(office(AFTER, [passedTo("tony", "Tony", 2)]));

    // The change is still told, and the handoff is still on the map.
    const log = screen.getByRole("region", { name: "Seen while you watched" });
    await waitFor(() => expect(within(log).getAllByRole("listitem").length).toBeGreaterThan(0));
    expect(screen.getByText(/1 handoff in play/)).toBeDefined();

    for (let now = 0; now <= 10_000; now += 100) {
      frameAt(now);
      const seen = see(container);
      expect(container.querySelectorAll(".world-traveller")).toHaveLength(0);
      expect(seen.mikeSeated).toBe(true);
      expect(seen.othersMoved).toBe(false);
    }
  });
});
