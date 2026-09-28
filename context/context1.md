1. PROJECT IDENTITY
Product

UNIOFFICE

UNIOFFICE is an AI-native operating system for companies.

It is not intended to be merely:

a chatbot
a collection of AI chat windows
an agent marketplace
a task manager with AI added
a fake simulation

The intended model is:

A company where AI agents actually perform and coordinate work.

Core conceptual architecture:

Company
   │
   ├── Company Brain
   │      └── organizational knowledge / memory / context
   │
   ├── Atlas
   │      └── orchestration / planning / coordination
   │
   ├── Specialist Agents
   │      ├── Engineering
   │      ├── Finance
   │      ├── Research
   │      ├── People
   │      ├── Communication
   │      └── other domains
   │
   ├── Skills
   │      └── what agents know how to do
   │
   ├── Tools
   │      └── what agents can actually execute
   │
   ├── Workflows
   │
   ├── Governance
   │
   ├── Approvals
   │
   ├── Memory
   │
   ├── Artifacts
   │
   └── Events / execution history

The product philosophy is approximately:

Hire agents, not seats.

2. USER'S PRODUCT DIRECTION

The user wants UNIOFFICE to become something that can actually do work, not just demonstrate an AI interface.

The long-term objective is to build a sufficiently functional product that can be demonstrated to investors and eventually support fundraising.

The user wants:

real execution
real agents
real delegation
real tools
real memory
real organizational context
real approvals
real governance
real artifacts
real autonomous operations
polished UI
strong product identity
good UX
gamification where useful
no fake backend behavior hidden behind impressive UI

A major principle established during development:

Functionality > UX > performance > visual effects

Visuals should enhance the underlying system rather than replace it.

3. USER'S WORKING STYLE / PREFERENCES

The user prefers:

direct answers
exact instructions
structured Markdown
practical implementation guidance
copy-paste-ready Claude Code prompts
detailed technical reasoning when architectural decisions matter
minimal ambiguity
strong protection against breaking existing functionality

When working with Claude Code, the user strongly prefers:

one meaningful coherent change
        ↓
test
        ↓
commit
        ↓
push
        ↓
verify
        ↓
next change

The user does not want Claude Code casually making huge unverified changes.

4. ABSOLUTE GIT RULES

These rules are extremely important.

Git identity

Every new commit must have exactly:

Madhavan <175943252+MAD1IZJOD@users.noreply.github.com>

as both:

Author
Committer

No:

Claude author
Claude committer
AI identity
Co-Authored-By: Claude
Claude-Session
GitHub API-created commits
forged authorship

The commits must be legitimate local Git commits using the user's configured Git identity/authentication.

Never
force push
rebase published history
amend published commits
rewrite old commits
modify old commit dates
modify old authorship
reset/discard unexpected user changes
overwrite unrelated work

Existing historical commits may contain old Claude trailers. Do not rewrite them.

Before every change

Claude must inspect:

git status
git branch --show-current
git log -1 --format=fuller
git remote -v
git diff
git status --short

Also inspect untracked files.

If unexpected changes are present:

STOP. Do not discard them.

After each coherent change

Run relevant:

tests
typecheck
lint
build

Then:

git status
git diff

Stage only files belonging to that change.

Commit.

Verify:

git log -1 --format=fuller

and confirm exact author + committer.

Then:

git push origin main

Finally verify:

git status
git rev-parse HEAD
git rev-parse origin/main

They must match and the working tree must be clean.

5. REPOSITORY

GitHub repository:

https://github.com/MAD1IZJOD/unioffice

Owner:

MAD1IZJOD

Default branch:

main

Local project:

D:\personal projects\unioffice

Remote:

origin
6. TECHNOLOGY STACK
Monorepo
apps/
  api/
  worker/
  web/

packages/
  agents/
  core/
  database/
  governance/
  memory/
  orchestrator/
  tools/
  workflows/

Additional documentation/infrastructure:

docs/
infrastructure/
scripts/
Root commands
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test

Underlying architecture uses Turbo.

Versions / environment

Known environment:

Node: 24.18.0
pnpm: 11.22.0
Turbo: 2.10.13
React: 19.3
Vite: 8.3
Vitest: 5.0.1
TypeScript: 6.0
ESLint: 10.10
React Router: 7.18.4
Supabase JS: 2.116
PostgreSQL: 17.6

Frontend:

React
Vite
TypeScript
Tailwind/CSS
Lucide
custom design system

Backend:

Fastify
Supabase/PostgreSQL
durable worker
Ollama/Qwen

LLM:

Ollama
http://127.0.0.1:11434
qwen3:8b

Embedding model:

nomic-embed-text
7. LOCAL / PRODUCTION ARCHITECTURE

Local:

Web
localhost:5173

API
127.0.0.1:4000

Ollama
127.0.0.1:11434

Production domains:

unioffice.online
    marketing

unioffice.pro
    application

api.unioffice.pro
    backend

Cloudflare Tunnel:

unioffice-local

Routes:

api.unioffice.pro
        ↓
http://localhost:4000

Ports 4000 and 11434 should not be publicly exposed.

Backend currently depends on the user's Windows machine, so there is no production failover yet.

8. SUPABASE

Supabase project:

unioffice software

Project ref:

qlavqcbtlnhxlvuqfqiu

RLS:

enabled
forced
across the database tables

Browser access is deliberately restricted.

Service-role key is server-only.

Important:

A service-role secret was accidentally exposed in an earlier conversation. Never repeat or embed any secret. Treat exposed secrets as compromised and rotate them if necessary.

The browser must never receive service-role credentials.

9. CORE DATABASE ENTITIES

The system includes entities such as:

organizations
workspaces
agents
works
tasks
workflows
workflow_nodes
artifacts
events
approval_requests
memories
execution jobs / queue
skills
skill_versions
action_proposals
memberships
roles / workspace access

The architecture is built around durable work rather than ephemeral chat.

10. AGENTS

Current primary agents include:

Atlas

Role:

orchestration
planning
coordination
decision support

Atlas does not directly use tools.

Forge

Engineering / technical work.

Capabilities include:

coding
technical design
data transformation

Tools include things such as:

calculator
datetime
JSON transformation
Ledger

Finance / analytical work.

Used for:

financial analysis
calculations
decision support
Nova

Research / synthesis / writing.

Kindred

People / organizational processes / writing.

Relay

Communication / stakeholder messaging / writing.

The product generally uses first names rather than fictional surnames.

11. AGENT EXECUTION MODEL

The intended execution chain is:

User request
      ↓
Mission / Work
      ↓
Atlas
      ↓
Planner
      ↓
Tasks
      ↓
Delegation / resolver
      ↓
Specialist agent
      ↓
Skill
      ↓
Tool
      ↓
Result
      ↓
Artifact / Memory / Event
      ↓
Company Brain

The system is designed around actual backend state.

12. PLANNER

The planner uses Qwen/Ollama to generate structured tasks.

Planner validation includes:

references
dependencies
cycle detection
agent requirements
capabilities
tools
approvals
task structure

There is deterministic validation after LLM planning.

The planner is not the ultimate source of truth for security or governance.

13. DELEGATION

Delegation is capability-aware and deterministic.

Resolver signals include:

named-person match
planner signal
capability/tool matching
name word match
category match
description words
workspace affinity
specificity

Current known resolver weights include:

named person: 1000
planner: 200
capability/tool match: 40
name word: 25
category: 15
description words: 5

Matching is deterministic.

Ties resolve based on:

scope
specificity
slug

Equal candidates may resolve to none rather than choosing arbitrarily.

Important distinction:

Known capability shortfall

If an agent never had a capability but is otherwise the best assignment, the router can record:

delegation.unmatchedCapabilities

This is treated as a limitation, not necessarily a hard blocker.

Lost capability

If the agent had the capability when the task was planned but loses it later, that should be a hard blocker.

This distinction is critical for the current Mission Startability work.

14. SKILLS

UNIOFFICE has a proper skill system.

There are:

system skills
organization skills
workspace skills

The narrowest applicable scope wins.

Skill lifecycle:

draft
active
archived

Skills have versions.

Important guarantees:

first system skill use gets pinned
execution uses the pinned version
publishing a new version does not silently change existing pinned execution
missing pinned version does not silently substitute another version

Agent assignment requires that the selected agent already holds every required:

skill
tool
capability
15. APPROVALS

Approvals are durable entities.

There is an action_proposals mechanism.

Approval binding includes:

exact action facts
skill
skill version
tools
SHA-256 fingerprint

Before execution, the current action is recomputed and compared with the approved fingerprint.

If it changes:

old approval becomes superseded
execution is blocked
new approval required

This prevents:

"User approved one action but the system secretly executes another."

Approval requirements are not automatically equivalent to:

BLOCKED

A mission may be startable while execution pauses at an approval gate.

16. GOVERNANCE

Governance is deterministic.

It must not depend on the LLM deciding whether something is allowed.

Governance covers:

policies
permissions
risk
tool authorization
approval requirements
audit trails
mission enforcement

There is a distinction between:

what an LLM wants to do

and:

what UNIOFFICE actually permits

The second is authoritative.

17. MEMORY / COMPANY BRAIN

Company Brain is a real organizational knowledge layer.

It contains:

memories
knowledge
provenance
conflicts
contested information
organizational context

Completed and failed tasks can automatically produce memory records.

Relevant memories are selected using:

keyword relevance
recency
importance

There is a conflict mechanism.

Brain can identify disputed knowledge and allow it to be settled.

The UI intentionally surfaces provenance and conflict status.

18. DURABLE EXECUTION

The system has a Supabase-backed durable job queue.

Worker responsibilities include:

atomic job claiming
leases
heartbeat
stale recovery
duplicate prevention
durable execution

Independent tasks can execute concurrently.

Task execution persists:

artifacts
events
results
memories
execution state

The system does not depend entirely on an HTTP request remaining alive.

19. RBAC

Roles:

owner
admin
member
viewer

Owners/admins have broad workspace access.

Members/viewers have organization-wide work access plus appropriate workspace grants.

Important security behavior:

membership is re-read immediately before sensitive actions
long-running streams re-check periodically
member decisions are constrained
owner/admin authority is required for certain knowledge and governance operations

Security has been tested extensively.

Google login and email magic links exist.

The development owner claim was configured for the user's Google account.

20. CURRENT FRONTEND INFORMATION ARCHITECTURE

The UI has been redesigned around the user's actual mental model:

"I need something done → tell it → see who's on it → approve when asked → get the result → find it later."

Primary product surfaces include:

Home / Command Center
Missions
Approvals
Workforce
Company Brain
Schedules
Rules
Results / Artifacts
Tools
Settings

Internal backend concepts should generally remain behind:

Details
Logs
Technical information

The product should not expose internal engineering vocabulary unnecessarily.

21. UX REDESIGN

A major redesign was completed.

Design direction:

premium
dark
art-directed
spatial
tactile
cinematic
slightly 3D
original
not generic SaaS
not generic cyberpunk
not neon for the sake of neon

The design uses CSS/markup rather than introducing a giant rendering engine.

GSAP/Anime.js/Three.js were discussed.

Decision:

CSS 3D is low-risk
GSAP is acceptable if genuinely useful
do not add both GSAP and Anime.js without reason
Three.js/WebGL only if justified
visual systems must remain subordinate to actual React/backend state

The broad redesign did not end up adding GSAP, Anime.js or Three.js.

22. UX AUDIT FINDINGS

Before the redesign, the biggest issues were:

Command Center felt more like triage than "start here"
mission creation was too deep
Execution Room exposed internal technical terminology
mission lists contained test junk
approvals were actually one of the strongest trust surfaces
Skills could expose unavailable capabilities
Tools exposed raw JSON
Company Brain had unexplained numbers
Governance lacked a starter path
there was no strong first-run path
architecture leaked through at trust-critical moments
"Delivered" could mean process completion rather than successful business outcome

These were largely addressed.

23. FIRST-RUN / READINESS

A readiness endpoint was introduced.

First-run experience checks whether the organization has opened a mission.

Readiness includes concepts around:

workforce
readiness
rules
first mission

The system uses actual backend state rather than localStorage hacks.

Owner/admin can remediate readiness.

24. MISSION INTELLIGENCE

Mission Brief includes:

Brief
Preflight
Plan
Company Brain context

There is an endpoint around:

/work/:id/intelligence

and:

/missions/:id/brief

Mission intelligence includes:

preflight
timeline
handoffs
structured outcomes
knowledge
relevant context

The execution room uses real execution data.

25. MISSION EXECUTION ROOM

The Execution Room visualizes actual execution.

It includes:

stages
timeline
handoffs
outcomes
technical details
agent activity
completion state
errors
artifacts

The redesign intentionally hides internal implementation details until needed.

For example:

Instead of exposing:

resolver lane
capability IDs
proposal UUID

the UI should generally communicate:

who is doing it
why
what they're doing
what happened

and expose technical details behind a Details control.

26. SCHEDULES / AUTONOMOUS OPS

UNIOFFICE supports continuous missions.

Scheduling supports:

hourly
daily
weekdays
weekly
timezone
DST behavior
run history
next run
previous run
self-pausing

Rules can enforce conditions.

Autonomous operation can pause after repeated failures.

Important existing behavior:

missed occurrence should execute exactly once
unique schedule occurrence
one run at a time
repeated failure can self-pause
owner ability loss can self-pause
27. RECENT VALIDATION

A broad validation phase was completed.

Workloads included:

missions
scheduled runs
pause/resume
failure handling
Company Brain conflict
security
execution

Two fixes were made:

4cae33a

Fixed planner offering unavailable tools/connections causing scheduled failures.

e658f2e

Fixed false Company Brain conflicts.

28. UX POLISH COMMITS

The broad UI redesign produced approximately 25 commits and reached:

f44601d

Then targeted UX fixes were made.

Final known visual polish commit:

778ffe8

This was pushed.

Known state:

main
HEAD = 778ffe8
origin/main = 778ffe8
working tree clean

Tests/typecheck/lint/build were passing at that point.

29. PERFORMANCE

The redesign reduced frontend bundle size substantially.

Approximate progression:

729 KB main JS
        ↓
496 KB main JS

Compressed:

211 KB
   ↓
147 KB

Another earlier optimization brought overall frontend bundle around:

720 KB → lower

Current remaining concern:

Some pages take roughly 7–20 seconds to populate.

This is a known product-hardening issue.

It has not yet been fully diagnosed.

30. MULTI-TAB ISSUE

There is a known issue where multiple tabs can hang because of approximately six HTTP/1.1 connections.

This is a future architecture/performance item.

Do not blindly rewrite networking before measuring it.

31. SCHEDULE TEST FLAKINESS

A Schedules test can occasionally time out when the full monorepo test suite runs in parallel.

This is a known issue.

It should be investigated rather than simply increasing arbitrary timeouts.

32. KNOWN VISUAL QA GAPS

Some state-dependent visual states were not observed with genuine backend data during final visual QA:

working agent floor
handoff state
completion moment
approval cards
composer sending
reduced-motion mode

These should eventually be tested with actual state rather than fake fixtures where possible.

33. IMPORTANT CURRENT ISSUE: MISSION BRIEF VS ROOM

This is the immediate technical hardening task we had reached.

The problem:

Mission Brief

Can say:

BLOCKED
Execution Room

May still show:

Run it
Backend /execute

Previously did not use exactly the same complete eligibility decision before enqueueing.

This creates contradictory UX and potentially incorrect execution behavior.

34. DIAGNOSIS ALREADY COMPLETED

Claude Code was asked to inspect this problem without modifying code.

It found:

MissionBrief.tsx
    ↓
fetchMissionIntelligence(id)
    ↓
GET /work/:id/intelligence
    ↓
MissionIntelligenceService.getIntelligence()
    ↓
preflightOf()

The Brief's preflight currently checks things like:

task planning
workspace/tool authorization
governance
skill fit
agent readiness

Any blocker could make the mission appear blocked.

The Room uses:

GET /work/:id/room

but its current "Run it" decision is more simplistic, based around:

permission
plan steps
active queue job
lifecycle status

POST /work/:id/execute ultimately calls:

ExecutionQueueService.enqueueWork()

The queue previously checked duplicate active jobs but did not perform the complete startability decision.

35. CURRENT PROPOSED FIX

Create one reusable server-side startability decision.

Likely inside or near:

MissionIntelligenceService

Conceptually:

MissionIntelligenceService.startability(...)

It should return a consistent decision containing something like:

canStart
state
headline
startNote

plus whatever existing preflight information is needed.

Then:

Mission Brief
       ↓
same server decision

Execution Room
       ↓
same server decision

POST /execute
       ↓
fresh server decision

This avoids three different definitions of "can run."

36. IMPORTANT SEMANTIC DISTINCTIONS

Do NOT collapse these states:

BLOCKED
LIMITED
APPROVAL REQUIRED
READY
RUNNING
COMPLETED
FAILED
CANCELLED
Known capability shortfall

An agent being assigned despite a capability it does not have can be:

LIMITED

because this is a known deficiency at assignment time.

Lost capability

If an agent had a required capability when planned but loses it before execution:

BLOCKED

This is different.

Approval

Approval should not automatically make:

canStart = false

A mission may begin and then pause for approval.

Completed

A completed mission should not be restarted using ordinary:

POST /execute

Retry should remain a distinct operation.

Failed

Failed work should generally use the existing retry/recovery path rather than treating execute as a universal restart button.

Cancelled

Cancelled work should not silently become executable again.

Active job

Do not create another active job.

37. PROPOSED IMPLEMENTATION

The previously prepared implementation plan was:

1. Canonical server-side startability

Create a reusable server decision.

It should consider:

RBAC
lifecycle
planned tasks
task agent existence
agent active status
organization ownership
workspace correctness
required tools
governance
skills
capabilities
active jobs
relevant hard blockers
2. Preserve known capability semantics

Do not treat:

delegation.unmatchedCapabilities

as identical to a capability that disappeared after planning.

3. Room API

Add startability information to the Room response:

start: {
  canStart,
  state,
  headline,
  startNote
}

Additive change preferred.

4. Room UI

The Room should show:

Run

only when the authoritative server says it can start.

Otherwise communicate why.

5. /execute

Before enqueueing:

RBAC
  ↓
fresh startability check
  ↓
if invalid:
    409
  ↓
if valid:
    enqueue

This addresses stale-page problems.

6. Automated execution

Do not redesign these in this phase:

scheduled starts
launch-then-auto-run
approval resumes
retries

Keep Phase 1 narrowly scoped.

38. PROPOSED TESTS FOR STARTABILITY

Backend tests should cover at least:

Ready
startable mission
→ canStart true
Known capability shortfall
agent assigned without known capability
→ not falsely blocked
Lost capability
agent loses required capability after planning
→ blocked
Paused agent
agent inactive/paused
→ blocked
Removed agent
agent unavailable
→ blocked
Wrong workspace
agent not valid for mission workspace
→ blocked
Denied tool
required tool unauthorized
→ blocked
Approval
approval required
→ startability semantics preserved
Active job
active job
→ no duplicate execution
Completed
completed mission
→ cannot execute normally
Failed
failed mission
→ normal execute should not become universal retry
Cancelled
cancelled mission
→ cannot execute normally
No tasks
no plan/tasks
→ not executable
RBAC
viewer/member without permission
→ 403
Cross-surface consistency

Verify:

Mission Brief
=
Execution Room
=
POST /execute

with respect to startability.

39. CURRENT STATUS OF THAT IMPLEMENTATION

Important:

The diagnosis was completed.

The implementation prompt was prepared.

But according to the last known conversation state, Claude had not yet returned its implementation result.

Therefore, a new ChatGPT session should not assume the fix is already implemented.

First inspect Git:

git status
git log -1 --format=fuller
git log --oneline -10

If HEAD is still:

778ffe8

then the implementation has not yet been committed.

40. NEW FEATURE IDEA: UNIOFFICE WORLD

After discussing the Mission Startability phase, the user introduced a new feature idea.

The feature is essentially:

A game-like visual office where users can watch their actual AI agents working.

Working name:

UNIOFFICE WORLD

This is not necessarily the final name.

41. USER'S REFERENCE

The user uploaded a reference image showing simple character-like figures.

The desired aesthetic is:

simple
pixelated
cute
slightly silly
recognizable
low-detail
consistent character body
distinctive accessory/prop for each profession

The reference was not intended to be copied literally.

The user explicitly said the characters should be:

"not this complex but simpler and pixelated"

42. UNIOFFICE WORLD CONCEPT

The idea:

UNIOFFICE
   │
   ├── normal product interface
   │      ├── missions
   │      ├── approvals
   │      ├── workforce
   │      ├── brain
   │      └── results
   │
   └── WORLD
          ├── Engineering Room
          ├── Design Room
          ├── Logistics Room
          ├── Finance Room
          ├── Research Room
          ├── People Room
          ├── Communication Room
          └── other organizational spaces

Agents have physical representations inside these rooms.

43. AGENT VISUAL DESIGN

All agents should share a common base character design.

For example:

same body
same scale
same visual language
different department accessory

Examples:

Engineering agent

Could have:

wrench
laptop
hard hat
screwdriver
technical accessory
Design agent

Could have:

brush
pencil
design tablet
palette
Finance agent

Could have:

calculator
ledger/book
coins
spreadsheet-like prop
Research agent

Could have:

magnifying glass
book
papers
Communication agent

Could have:

phone
speech bubble
headset

The accessory should make the role readable instantly.

44. ROOMS

The user specifically wants rooms such as:

Engineering Room
Designing Room
Logistics Room

and ultimately:

all sorts of rooms where most lead agents live

Potential mapping:

Engineering
Design
Finance
Research
Operations
People
Communication
Product
Support
Strategy

However, the system should not invent departments that have no meaningful relation to actual UNIOFFICE agents.

The room model should be extensible.

45. LEAD AGENTS + SUB-AGENTS

The user wants rooms where:

lead agents live/work
sub-agents can exist
agents can move between departments

This suggests a future spatial representation of the organizational hierarchy.

For example:

Engineering Room

        Forge
         │
    ┌────┼─────┐
    ↓    ↓     ↓
  Code  Test  Data
 Agent Agent Agent

But this should not be hardcoded as fake employees.

The actual agent registry should drive it.

46. AGENT-TO-AGENT MOVEMENT

This is one of the most important parts.

The user wants:

when agents contact each other they just get up and go meet with other agents

For example:

Forge needs research from Nova

Engineering Room
      Forge
        ↓
      walks
        ↓
Research Room
        ↓
      Nova

Then the UI can show them interacting.

This should be based on real execution events.

47. CRITICAL PRINCIPLE FOR UNIOFFICE WORLD

Do not create fake activity simply to make the office look alive.

For example, do not have agents randomly:

walking around
drinking coffee
talking
opening laptops
visiting other agents

unless the product has a meaningful state/event behind the animation.

The World should be a:

visualization of actual UNIOFFICE activity

rather than:

fake game behavior pretending the agents are working.

This distinction is critical.

48. POSSIBLE EVENT → ANIMATION MODEL

A future event adapter could transform real events into visual states.

Example:

Task assigned to Forge
        ↓
Forge becomes active
        ↓
Forge walks to workstation
        ↓
Forge works
        ↓
Tool execution
        ↓
Forge shows tool/action state
        ↓
Artifact produced
        ↓
Forge becomes available

Agent-to-agent dependency:

Task A completed by Forge
        ↓
Task B requires Forge output
        ↓
Nova needs that result
        ↓
World shows Forge → Nova movement
        ↓
handoff
        ↓
Nova works

Approval:

Agent reaches approval gate
        ↓
Agent pauses
        ↓
Needs You indicator
        ↓
Human approves
        ↓
Agent resumes

Failure:

Agent task fails
        ↓
Agent enters error state
        ↓
Room communicates failure
        ↓
Mission UI explains actual issue
49. WORLD SHOULD NOT BECOME A SECOND BACKEND

Important architecture:

Existing UNIOFFICE backend
        ↓
events / tasks / agents / execution
        ↓
World Event Adapter
        ↓
World state
        ↓
visual rendering

Do not build an independent simulation backend.

The World should consume authoritative UNIOFFICE state.

The same agent should be:

Agent in database
        =
Agent in Workforce
        =
Agent in Mission Room
        =
Agent in UNIOFFICE World
50. WORLD SHOULD COEXIST WITH NORMAL UI

Do not replace Mission Control.

There should be two complementary ways to understand the company:

Operational view

Precise:

mission
task
agent
approval
result
logs
artifacts
timeline
World view

Intuitive:

where agents are
who is working
who is waiting
who is talking to whom
which department is busy
where work is happening

The World is the spatial visualization layer.

51. VISUAL DIRECTION FOR WORLD

Preferred:

pixel art
low-detail
simple silhouettes
consistent character scale
slightly playful
premium enough to fit UNIOFFICE
not childish
not overly complex

Avoid:

realistic 3D characters
giant 3D game engine
photorealistic environments
cyberpunk neon
generic metaverse aesthetic
unnecessary visual complexity
huge assets that destroy bundle performance

The office should feel like a small living system.

52. TECHNICAL DIRECTION FOR WORLD

Before introducing:

Three.js
WebGL
PixiJS
large game engine

evaluate whether CSS/DOM/canvas or a lightweight renderer is sufficient.

Possible architecture:

React
   +
CSS / 2D transforms
   +
small pixel-art assets
   +
state-driven animation

If scale becomes large:

Canvas / lightweight 2D renderer

could be considered.

Do not introduce a rendering framework merely because it looks impressive.

53. PERFORMANCE PRINCIPLE FOR WORLD

The existing product already has performance work remaining.

Therefore:

Do not let UNIOFFICE World turn the web app into a 500MB game.

Prefer:

sprite sheets
small assets
lazy loading
room-level loading
limited animation
GPU-friendly transforms
no unnecessary filters
no permanent high-frequency animation
pause animations when hidden
reduced-motion support
54. WORLD MVP

A sensible first version would not build the entire company.

Build one functional vertical slice.

Example:

UNIOFFICE WORLD
       │
       ├── Engineering Room
       │      └── Forge
       │
       └── Research Room
              └── Nova

Then create a real mission where:

Forge
   ↓
does engineering task
   ↓
needs Nova
   ↓
Nova performs research
   ↓
returns result
   ↓
Forge continues

The World should visually represent that real mission.

If that works, expand to more rooms and agents.

55. WORLD STATES

An agent should have visual states derived from real backend state.

Potential states:

idle
working
walking
handoff
waiting
needs_approval
blocked
failed
completed

But do not invent these as arbitrary game states.

Map them to actual execution semantics.

56. WORLD INTERACTIONS

Potential future interactions:

Click agent

Shows:

Forge
Engineering

Current mission:
Build expense analysis

Current task:
Calculate monthly spend

Status:
Working

Skills:
...

Tools:
...

View mission →
Click room

Shows:

Engineering
3 agents
2 working
1 idle

Current work:
...
Click interaction

Shows:

Forge → Nova

Reason:
Research dependency

Mission:
...

Task:
...
Click artifact

Open actual artifact.

Click approval state

Open actual approval.

The World should always lead back into the operational product.

57. GAMIFICATION PHILOSOPHY

The user wants the experience to feel:

"a little gamified"

Not:

"turn the company into an RPG with meaningless XP."

Avoid fake:

XP
coins
leaderboards
levels
achievement spam
arbitrary productivity scores

Instead, gamify through:

spatial movement
visible activity
character identity
rooms
collaboration
progress
satisfying transitions
completion moments

The work itself remains the game loop.

58. IMPORTANT TRUST PRINCIPLE

If the World shows:

Forge is talking to Nova

there must be a real reason.

If it shows:

Forge is working

Forge must actually have an active task.

If it shows:

Agent waiting for approval

there must actually be an approval state.

If it shows:

Forge delivered artifact

an actual artifact should exist.

This is one of the most important design constraints for the feature.

59. CURRENT ROADMAP

The roadmap immediately before the World idea was:

UX redesign
       ↓
UX polish
       ↓
MISSION STARTABILITY       ← current hardening task
       ↓
performance investigation
       ↓
multi-tab architecture
       ↓
schedule test stability
       ↓
state-dependent visual QA
       ↓
failure/recovery hardening
       ↓
security regression
       ↓
product expansion

The World feature is now a potential product-expansion feature.

However, it should first be architecturally mapped against the current system rather than immediately implemented.

60. RECOMMENDED ORDER NOW

When continuing in a fresh Claude Code session:

Step 1 — Recover repository state
git status
git log -1 --format=fuller
git branch --show-current
git remote -v

Confirm whether:

778ffe8

is still HEAD.

Step 2 — Inspect whether Mission Startability was implemented

Search for changes around:

MissionIntelligenceService
startability
preflightOf
/work/:id/intelligence
/work/:id/room
/work/:id/execute
ExecutionQueueService

Do not assume anything.

Step 3 — If implementation is not present

Implement the canonical Mission Startability fix first.

Step 4 — Before building World

Design the event/state mapping.

Specifically answer:

What existing event means "agent started working"?
What means "agent finished"?
What means "agent handed off"?
What means "agent needs another agent"?
What means "approval required"?
What means "agent failed"?
What means "agent waiting"?
Step 5 — Build a tiny World prototype

One or two rooms.

Real agents.

Real mission.

Real movement.

Real events.

Then evaluate.

61. WHAT NOT TO DO NEXT

Do not immediately tell Claude:

"Build the entire metaverse office."

That risks:

huge scope
fake state
unnecessary rendering architecture
performance problems
duplicated backend logic
visual polish before the state model exists

Instead:

Build the smallest real vertical slice that proves the concept.

62. EXISTING PRODUCT QUALITY BAR

UNIOFFICE has already reached a relatively advanced point.

Previous validation included:

hundreds of backend tests
hundreds of web tests
live end-to-end missions
real financial-analysis mission
real Ledger execution
real calculator tool
real artifacts
real approvals
real Company Brain entries
real skill routing
real schedules
real RBAC
production frontend
Google authentication
RLS/security validation
responsive visual QA

Therefore new features should meet the same standard.

63. TESTING EXPECTATION

For every meaningful new feature:

unit tests
integration tests
backend tests
frontend tests
typecheck
lint
build
live E2E where applicable
visual QA where applicable

For World specifically:

agent creation/rendering
room mapping
event mapping
movement
handoff
idle state
working state
approval state
failure state
no-fake-activity behavior
real mission synchronization
responsive behavior
reduced motion
tab visibility/performance
64. CURRENT PRODUCT LIMITATIONS TO REMEMBER

Known limitations:

Backend hosting

Production backend still relies on the user's local Windows machine.

Ollama

Model can unload after idle.

First mission after idle may take significantly longer.

Planning

Some missions have planning latency around ~162 seconds in previous production tests.

Frontend loading

Some surfaces have 7–20 second data-loading experiences.

Multi-tab

Multiple tabs can cause connection issues.

Schedule tests

Some schedule tests can be flaky under full parallel test load.

Visual state coverage

Some real states still need visual QA.

Bundle

Frontend bundle has been substantially improved but remains an optimization target.

Workflows

A full visual workflow editor/runner was previously deferred.

Planner

Small-model planner may occasionally fail to name a skill even though the backend remains safe.

65. SECURITY PRINCIPLES

Never weaken:

RLS
RBAC
governance
approval binding
action fingerprinting
tool authorization
workspace authorization
server-side authorization

Never rely on:

frontend hides button

as a security mechanism.

Backend must independently enforce.

66. IMPORTANT PRODUCT TERMINOLOGY

Preferred user-facing terminology:

Mission
Step
Agent
Result
Output
Company Brain
Rule
Approval
Workforce

Internal terms should remain behind Details where possible.

Avoid exposing unnecessarily:

lane
resolver score
proposal UUID
internal IDs
raw JSON
capability IDs
database concepts

The product should explain itself.

67. ERROR UX

Errors should answer:

What happened?
Why?
What does it affect?
What can I do?

Avoid dumping raw:

planner exception
database stack
UUID
internal implementation error

unless the user opens technical details.

68. MISSION LANGUAGE

Avoid saying:

Delivered

when a mission merely completed a procedure.

A mission should distinguish:

success
failure
cancelled
blocked
waiting

A finished process is not necessarily a successful business outcome.

69. VISUAL DESIGN RULES

The current UI direction should be preserved.

Do not revert to:

generic SaaS cards everywhere
dashboard grid overload
excessive gradients
neon cyberpunk
generic glassmorphism
unnecessary animation
visual noise

Use:

hierarchy
depth
spatial composition
typography
restrained motion
tactile interaction
meaningful state transitions
70. USER'S NEW FEATURE IN ONE SENTENCE

The newest idea can be summarized as:

Create a pixel-art, game-like "UNIOFFICE World" where the user's actual AI agents visibly live and work inside departmental rooms, and real task/dependency/communication events cause agents to move around and meet each other.

71. THE MOST IMPORTANT ARCHITECTURAL REQUIREMENT FOR THIS FEATURE

The World must visualize the existing company execution graph.

Not:

World simulation
      ↓
fake agents
      ↓
fake work

Instead:

Real UNIOFFICE
      ↓
real tasks
      ↓
real events
      ↓
real agents
      ↓
World visualization
72. CURRENT NEXT ACTION

When starting the new ChatGPT conversation, paste this document first.

Then say something like:

"This is the transfer document from my previous UNIOFFICE conversation. Treat it as the current project context. First help me recover the exact current state and then continue from the appropriate point. I have a new feature idea called UNIOFFICE World described in the document."

Then the new ChatGPT should:

confirm understanding,
inspect/establish current state if needed,
determine whether Mission Startability is implemented,
discuss the World architecture,
produce a fresh Claude Code prompt when implementation is ready.
73. FINAL STATE SNAPSHOT
PROJECT
UNIOFFICE

PRODUCT
AI-native company operating system

REPOSITORY
MAD1IZJOD/unioffice

BRANCH
main

LAST KNOWN COMMIT
778ffe8

LAST KNOWN STATE
clean
origin/main matched

CURRENT HARDENING TASK
Mission Brief / Execution Room / /execute
must share one authoritative server-side
mission-startability decision

CURRENT FEATURE IDEA
UNIOFFICE World

WORLD CONCEPT
Pixel-art office
        ↓
departmental rooms
        ↓
real agents represented as characters
        ↓
real execution state drives animation
        ↓
agents move between rooms for real handoffs
        ↓
gamified but not fake

FIRST WORLD MVP
1–2 rooms
+
real agents
+
real mission
+
real agent movement
+
real handoff
+
real execution state

ABSOLUTE RULE
Never fake agent activity.

This is the authoritative transfer context to carry forward.

image.png

# 74. AUTHORITATIVE AGENT RENAMING

IMPORTANT: The agent names in the current codebase evolved during development.

Earlier in the project, agents had role-based names such as:

- Atlas
- Forge
- Ledger
- Nova
- Kindred
- Relay

Those names are now OUTDATED for the user-facing agent identities.

The agents were subsequently renamed to more human/common names, and then renamed again.

The CURRENT canonical names are the names shown in the latest UNIOFFICE World design:

- Company Hall:
  - Tyrion
  - Jamie
  - Peter

- Customer Success:
  - Rhea

- Engineering:
  - Dana
  - Tony

- Finance:
  - Harvey

- Operations:
  - currently no agent shown

- Research:
  - Mike

These are the CURRENT USER-FACING AGENT NAMES.

## Important distinction

The old names such as:

Atlas
Forge
Ledger
Nova
Kindred
Relay

should NOT continue appearing in the user-facing product simply because they existed in earlier architecture/design documents.

They represent the earlier role/agent naming system.

The current World/UI identity should use the latest names:

Tyrion
Jamie
Peter
Rhea
Dana
Tony
Harvey
Mike

Do NOT rename these back to Atlas, Forge, Ledger, Nova, Kindred, Relay.

Do NOT invent new human names.

Do NOT replace them with generic labels such as:
- Engineering Agent
- Finance Agent
- Research Agent

unless a UI context specifically requires the role/department label.

The intended model is:

Agent identity = human-style name
Agent role = department/function

For example:

Harvey
Finance

Mike
Research

Dana
Engineering

Tony
Engineering

Rhea
Customer Success

The World screenshot is therefore the latest visual reference for agent identity.

## Migration requirement

When implementing UNIOFFICE World, inspect the existing agent definitions, seed data, fixtures, UI references, and mock data.

Where the old names are still being used as actual user-facing agent names, migrate them to the current canonical names above.

Preserve the underlying agent identity/database relationships and functionality.

Do NOT create duplicate agents merely because their names changed.

Do NOT change agent IDs solely because the display name changed.

The rename should be treated as a display/identity naming evolution unless the existing architecture explicitly requires otherwise.

Most importantly:

The World should display the current names shown above, not the historical Atlas/Forge/Ledger/Nova/Kindred/Relay names.

"this context is of till 28 september 2026 17:02 last shipped feature was gamifeid interface for agents "