# World

The workforce as an office. A second way into the same company - not a game,
and not a second company. Every desk, lit screen and parcel is a fact the
server reported, and everything that moves is a change the page watched
happen.

Open it from **Workforce → World** (`/world`).

## What it shows

| On the map | Means | Comes from |
| --- | --- | --- |
| A room | A workspace the viewer can reach | `workspaces`, narrowed by the viewer's grants |
| The company hall | Agents who work in every workspace (or whose workspace was archived) | the agent row |
| An agent at a desk | One agent, always in the same seat | the workforce read; seat order is fixed by the server |
| Lit screen, moving hands | On a step right now | a running task |
| Lock on the screen | On a step in a mission the viewer cannot open | the workforce read's `workingElsewhere` |
| Red bubble | Held until a person decides | a waiting task |
| Three dots | The planner writing a plan | a mission in `planning` |
| Zz, dimmed / faded | Paused / unavailable | the agent's status |
| Red flag by the desk | The agent's last step could not finish, within the last day | the workforce read's last outcome |
| Dashed route ending in a parcel | One step's finished result is another agent's input, still in play | the same handoffs the execution room reads |
| Mission board | Live missions the viewer may open, with progress | work summaries and task rows |

Movement happens only for:

- **a parcel crossing the corridor** - a handoff that appeared between two
  readings the page watched;
- **slips going out from the planner** - a plan handing out its steps.

Agents never leave their desks. There is no wandering, no conversation, no
score. An idle agent sits still and an empty room stays empty.

## How it stays honest

- **One read.** `GET /world` (`apps/api/src/world-service.ts`) is built only
  from reads that already exist: the workforce read, work summaries, the task
  rows of at most eight live missions, and the workspaces. It writes nothing,
  starts nothing and calls no model.
- **Movement is a difference between readings.** `apps/web/src/world/moments.ts`
  compares two consecutive snapshots. They count as consecutive only when the
  live channel carried both, on one unbroken connection, no more than 90
  seconds apart by the server's clock. The first reading, one after a
  reconnect and one after a gap are starting points: the office is drawn as
  it is, and nothing is replayed.
- **Deterministic places.** Rooms come in the server's order (hall first,
  then workspaces by name) and seats in a stable order (whoever plans first,
  then by name). `apps/web/src/world/layout.ts` is a pure function of that, so
  every reload and every tab puts everyone in the same place. Paths between
  desks go through doors and the corridor, never through walls.
- **Nothing leaks.** What the viewer cannot open is left out rather than
  greyed out: agents in workspaces they were not given, missions they cannot
  see, and handoffs in those missions. An agent busy on such a mission shows
  as working without saying on what.
- **Clicks authorize nothing.** The details panel links into the pages that
  own each action - the mission room, approvals, the agent's profile - where
  the server checks the person's role again. The decision link is offered
  only to roles that can decide.

## Transport and cost

- The page reads the shell's existing company-wide live channel, so watching
  the office opens no new connection. It re-reads `/world` when events
  arrive (coalesced) and every 30 seconds as a safety net.
- The page, its art and its stylesheet are a lazy chunk (about 43 kB of
  script, 12.5 kB gzipped, and 13 kB of CSS). Other pages pay only for the
  navigation entry - under 1 kB.
- The characters are drawn from pixel maps in code
  (`apps/web/src/world/sprites.ts`); there are no image assets.

## Accessibility and motion

- Every room, desk, route and mission card is a keyboard-focusable button
  with a spoken label that says the same thing the drawing shows.
- The map pans with drag or the arrow keys and zooms with the buttons, the
  plus and minus keys, or Ctrl + wheel (a trackpad pinch); a plain wheel
  scrolls the page.
- **List** shows the same office as rooms, people and handoffs in text.
- **Motion off** (the default under the system's reduced-motion setting)
  stops every animation; the same facts stay on the page, and each change is
  still written to *Seen while you watched* and announced to screen readers.
- On phones and tablets the details open as a sheet at the bottom of the
  screen.

## Known gaps

- There is no record of agents talking to each other, so the world never
  shows it. A handoff is one step's result becoming another's input.
- A step's skill is not in the snapshot, so the details panel does not name
  it; the mission room does.
- The mission brief's rules check projects tool-level policies only. A policy
  that refuses a whole step (for example by capability) is not foreseen by
  the brief and is enforced when the step runs.
