# World

The workforce as an office. A second way into the same company - not a game,
not a simulation and not a second company. Every desk, lit screen and parcel
is a fact the server reported, and everything that moves is a change the page
watched happen.

Open it from **Workforce → World** (`/world`), from a mission's room with
**View in World** (`/world?mission=<id>`), or from an agent's row or profile
in the Workforce with **View in World** (`/world?agent=<id>`). The details
of an agent in the World link back to its profile.

## What it is, and what it is not

World is a **view**. It projects what UNIOFFICE is already doing:

```
backend execution  ->  GET /world (one read-only projection)  ->  the page's renderer
(tasks, missions,      apps/api/src/world-service.ts              apps/web/src/pages/World.tsx
 agents, results)                                                  apps/web/src/world/*
```

It never adds to that. There are no simulated employees, conversations,
tasks, progress or wandering, no timers that make anything happen, and no
state the client makes up and presents as the server's. If the server has
not recorded something, World does not show it - it shows less, and says so.

Why this is a hard rule: people use World to see what their company is
doing. An office that looks busy when it is not, or shows a person working
who is not, is worse than no office - it teaches people to distrust every
other surface that reads the same data. So anything decorative that moves is
a defect, and the tests treat it as one.

**Mission Control stays the operational surface.** World starts, approves,
retries and changes nothing. Every action in it is a link into the page that
owns it - the mission room, approvals, the agent's profile, the workspace -
where the server checks the person's role again.

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

### Agent states

One function, `deskStateOf` (`apps/web/src/world/describe.ts`), turns the
server's fields into the state the desk draws. It reads only `status`,
`presence`, `workingElsewhere` and `planning`:

| State | When |
| --- | --- |
| unavailable | the agent is disabled, or its presence is unavailable |
| paused | the agent is paused |
| waiting | a step of theirs is held for a decision |
| working / elsewhere | on a running step - in a mission the viewer can open, or one they cannot |
| planning | the planner writing a plan |
| available | none of the above |

There is no "blocked" agent state, because nothing records one: a blocker
belongs to a mission's steps, and the mission brief is where it is shown.

### How each agent is drawn

Every agent is the same small figure. What it wears and has on its desk
comes from its discipline, which is read from the capabilities the server
granted it (`disciplineOf`, `apps/web/src/lib/workforce.ts`). Its hair and
haircut come from a stable hash of its id. With seventy-one agents and
eighteen in Engineering, the id alone is not enough to tell roommates
apart, so `castOf` (`apps/web/src/world/sprites.ts`) dresses each room in
seat order: anyone whose look a roommate of the same discipline already has
takes the next free hair and haircut. There are twenty-one per discipline.
The desk, a walk and the details all draw from that one cast, so an agent
looks the same everywhere. Nothing is random, and an agent whose look
nobody else in its room shares keeps its own.

### Rooms

Rooms are the server's rooms, in the server's order: the hall first, then
workspaces by name. A room's id is its workspace's id, so a mission's
`workspaceId` names its room. Choosing a room - on the map, in the list, in
the details or from search - opens what the snapshot says about it: who
works there, what each of them is doing, and the live missions in it.

## Movement

Only two things ever move, and each tells a moment the page watched happen
between two consecutive live readings (`apps/web/src/world/moments.ts`):

- **An agent walking to another desk** - a handoff: one step's result became
  another agent's step's input. The agent who finished gets up (their chair
  stands empty), carries the result to the other desk, sets it down, and
  walks back the same way. The walk is how the office shows a fact the task
  rows record; it is not a meeting.
- **Slips going out from the planner** - a plan handing out its steps.

Nothing else produces a trip. An agent starting, finishing or being held
changes their desk, never their place (`apps/web/src/world/travels.ts`).

The rules a walk keeps:

- **Two readings count as consecutive** only when the live channel carried
  both, on one unbroken connection, no more than 90 seconds apart by the
  server's clock. The first reading, one after a reconnect and one after a
  gap are starting points: the office is drawn as it is, and nothing is
  replayed.
- **A handoff walks once** - when it first appears. The same handoff changing
  state is news for the log, not a second trip.
- **Both ends must be on this floor.** A handoff whose sender or receiver the
  viewer cannot see draws no route, no parcel and no walk.
- **It walks the floor, not the furniture.** Every row of desks has an aisle
  in front of it, and walks and routes start and end there: in the open floor
  in front of the sender's desk and the receiver's, where the result is handed
  over and can be seen. In between they follow the aisles, the lanes down each
  side wall, the strip below a room's sign, the doorways and the corridor, and
  never cross a desk; every door opens onto floor. Within one room a walk
  follows the shared aisle, or a side lane to another row. The way is worked
  out from the floor plan alone (`apps/web/src/world/layout.ts`): the same two
  desks always give the same way, the way back is that way reversed, and
  nothing is chosen at random.
- **One figure per agent.** A result that feeds several steps is carried to
  each desk in turn: the agent makes one walk after another and their chair
  stays empty until the last one is done.
- **Nothing is cut short.** There is no limit on trips in flight; each ends
  on its own clock. A walk that waited its turn starts from when the one
  before it ended, so a tab that was in the background catches up in a frame
  instead of replaying stale walks.
- **Timed by the clock, not by frames.** Walks cover about 64 floor units a
  second, each way taking between 1.2 and 4.5 seconds, with 0.6 seconds at the
  other desk. The same moments on the same floor always make the same trips;
  there is no randomness anywhere.

### Reduced motion

**Motion off** - the default under the system's reduced-motion setting -
makes no trips at all and stops every animation. The same facts stay on the
page: routes and parcels still show handoffs in play, each change is still
written to *Seen while you watched*, and it is announced to screen readers.
Turning motion off clears any trip in flight; the agent is simply at their
desk.

## Finding things

**Search** (the field in the page's head, `apps/web/src/world/search.ts`)
looks only through the snapshot already on screen - no index, no request -
so it can never turn up something the map could not show. It finds:

- agents, by name, and by the step and mission they are on right now (only
  when the viewer may see that work);
- rooms, by name;
- live missions on the board, by name;
- work that changed hands, by the stored result's name, or by the steps on
  either side.

Matching ignores case. A whole match ranks above one that starts the name,
then one where a word starts with it, then one that merely contains it; a
match on what someone is doing ranks below a match on a name. Each hit says
what kind of thing it is. Picking one - click, or Enter for the first - does
what clicking the thing would: selects it and brings it into view. Escape
clears the search.

**Filters** (`apps/web/src/world/filters.ts`) answer "show me only the
agents doing X", using the states above in the workforce's own words:
Working, Waiting on a decision, Writing a plan, Available, Paused or
unavailable, and Last step failed (within the last day). Each shows how many
agents are in it now. Several at once keep an agent in any of them; none
keeps everyone. On the map a left-out desk is drawn quieter, never removed,
so the office keeps its true shape; in the list it is left out and the page
says how many are shown. Filters change what is shown, never anyone's state.
Search is not narrowed by filters.

## Details

Choosing an agent shows their room, state, what they are doing and since
when, their last outcome, the work changing hands with them, what they can
do, and - read from their profile (`GET /workforce/:id`, the same read and
the same access as the profile page) - their tools, with whether each is
allowed, needs approval or is denied, and their skills, with whether each can
be used. Names only: internal ids stay out of it, and the policy behind each
tool is on the profile. A role that can decide is offered the pending
decision.

## Camera

`apps/web/src/world/camera.ts` is a pure function from the floor plan, the
stage and a request to a view:

- one agent is centred, a little closer than the whole office and never
  further out than the view already was;
- a room, or a group of agents, is framed whole at a whole-number zoom so the
  pixel art stays crisp;
- **Fit** (or the `0` key) shows the whole office again.

Choosing an agent or a room brings it into view on the map. Dragging, the
arrow keys, the zoom buttons, the plus and minus keys and Ctrl + wheel carry
on from wherever the camera lands.

## A mission in focus

`/world?mission=<id>` opens the office on one mission. The id in the address
is never trusted on its own: it is only looked up in the snapshot the server
already built for this viewer (`apps/web/src/world/missionFocus.ts`).

- **In view:** the mission is chosen, the camera frames everyone on it - who
  holds one of its steps, and the planner if it is writing the plan (its
  room, while nobody holds a step) - and everyone else is drawn quieter. A
  note says so, with **Show the whole office**. Nobody is moved, and nobody
  off the mission gets any activity.
- **Not in view:** a mission that does not exist, belongs to another company,
  is not this viewer's to open or has finished are all treated the same -
  the whole office, one plain note, and no further request. Nothing on the
  page can tell them apart.

## An agent in focus

`/world?agent=<id>` opens the office on one agent: it is chosen, as a click
on its desk would, and the camera brings its desk into view once. Nobody is
quietened, and the viewer is free to look anywhere afterwards. As with a
mission, the id is only looked up in this viewer's snapshot: an agent that
does not exist, is another company's or sits in a workspace the viewer was
not given all read the same - the whole office and one plain note. When a
link names both a mission and an agent, the mission wins.

## Before you opened

The office moves only for what changes while it is watched, so on opening
the log *Seen while you watched* is empty. Under it, *Before you opened*
lists the last few events the server recorded about agents in this office -
steps started and finished, approvals, results, tool calls, agents joining
or being reconfigured - newest first (`apps/web/src/world/recent.ts`). It is
read once, from `GET /activity`, on opening. These are lines, never acted
out: nothing walks and no desk changes for them. Choosing one opens that
agent. A tool call is told once, by its outcome, and an assignment by the
step starting.

## Security and data isolation

- **One read.** `GET /world` is built only from reads that already exist:
  the workforce read, work summaries, the task rows of at most eight live
  missions, and the workspaces. It writes nothing, starts nothing and calls
  no model.
- **Narrowed on the server.** The read is scoped to the viewer's organization
  and the workspaces they reach. What the viewer cannot open is left out
  rather than greyed out: agents in workspaces they were not given, missions
  they cannot see, and handoffs in those missions. An agent busy on such a
  mission shows as working without saying on what.
- **Nothing on the client widens it.** Search, filters, mission focus and
  agent focus work on that snapshot and nothing else. The details panel's
  extra read is the agent's profile, which the server narrows the same way.
- **The record is narrowed twice.** `GET /activity` leaves out events from
  missions the viewer cannot reach, but lets through events tied to no
  mission. *Before you opened* therefore keeps only events about an agent in
  this viewer's snapshot, so an agent the World hides is never named there.
- **Clicks authorize nothing.** Every action is a link into the page that
  owns it, where the server checks the person's role again. The decision link
  is offered only to roles that can decide.

## Performance

- The page reads the shell's existing company-wide live channel, so watching
  the office opens no new connection. It re-reads `/world` when events
  arrive (coalesced) and every 30 seconds as a safety net.
- The page, its art and its stylesheet are a lazy chunk - about 60 kB of
  script (18 kB gzipped) and 16 kB of CSS (3.8 kB gzipped). Other pages pay
  only for the navigation entry.
- Opening it makes one read of the recorded activity (40 events) besides the
  snapshot; that is not repeated while the page stays open.
- The characters are drawn from pixel maps in code
  (`apps/web/src/world/sprites.ts`); there are no image assets.
- A walk writes its position straight onto its element each frame rather than
  through React state, so a trip costs only its own element. Desks are
  memoised. Nothing runs between trips: no timers, no animation frames.
- Search runs in memory over the snapshot and shows at most eight hits.

## Accessibility

- Every room, desk, route and mission card is a keyboard-focusable button
  with a spoken label that says the same thing the drawing shows.
- **List** shows the same office as rooms, people and handoffs in text, and
  honours the same filters and mission focus.
- On phones and tablets the details open as a sheet at the bottom of the
  screen.

## What holds it to this

- `apps/web/src/pages/World.test.tsx` - the page over the real client, with
  only the network (and, for movement, the live channel and the animation
  clock) scripted. It includes the handoff walk frame by frame, fan-out,
  bursts of handoffs, a hidden tab, reduced motion, and the guards: no reading
  means no movement, non-handoff changes move nobody, an off-floor sender
  draws no parcel, and no random number is ever drawn.
- `apps/web/src/world/*.test.ts` - moments, travels, layout, camera, search,
  filters, mission focus and the recorded activity, as pure functions.
- `apps/api/src/workforce-world-contract.test.ts` - the real provisioning,
  Workforce and World services over one agent store: an agent created
  through the owner/admin path appears in its workspace's room with its role,
  with nothing added to the World by hand.

## Known gaps

- There is no record of agents talking to each other, so the world never
  shows it. A handoff is one step's result becoming another's input.
- A step's skill is not in the snapshot, so the details name an agent's
  skills but not which one a step is using; the mission room does.
- Two readings can only name a handoff once. If one vanished from a reading
  and came back while its walk was still under way, the page would draw a
  second walk under the same name.
