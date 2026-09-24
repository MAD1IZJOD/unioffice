# Changelog

## Organizational control

Company work that keeps running on its own, under the company's rules, with
people deciding what is consequential.

### Continuous missions

- A continuous mission is a standing instruction - what to do, how often,
  whose it is - that starts an ordinary mission each time it comes due
  (`continuous_missions`, `continuous_mission_runs`). Each run is planned,
  delegated, governed, approved, executed and learned from by the existing
  pipeline and keeps its own plan, steps, approvals, results and failure.
- Schedules are hourly, daily, weekdays or weekly, in the company's own
  timezone. The next occurrence is a pure function of the schedule and an
  instant, and holds across daylight saving.
- The worker starts due runs on its own loop. One occurrence, one run: a
  unique key on (mission, occurrence) and a single transactional function
  that locks the instruction, checks the occurrence is still due, and writes
  the run's mission, the link and the next occurrence together. Repeated
  ticks, racing workers and restarts cannot start a second run or lose one.
- A scheduled job carries its own reason, so the runner plans the run before
  executing it. A run found half-planned after a crash is stopped rather than
  planned twice; one started but never queued is queued on a later tick.
- One run at a time: an occurrence that falls due while the last run is still
  going or waiting on a person is skipped and recorded. After three failed
  runs in a row a mission pauses itself; it also pauses itself when its owner
  can no longer start missions there, so it never outlives that permission.
- Create, pause, resume, cancel and run now, each checked against the same
  permissions missions use. Run history reads in the structured outcome's
  words: running, waiting for approval, completed (with limitations),
  blocked by a rule, failed, cancelled.

### Rules

- A rule can say when it applies, not only to whom: only for work a schedule
  started, or a person started; only when a step changes something outside
  the company, or only when it does not. Both are facts the server
  establishes itself - the mission row and the tool registry - so a plan can
  neither satisfy a condition nor talk its way out of one. Conditions are
  checked by the schema as well as the service, and never reach knowledge.
- Changing a rule records who changed it.

### Needs You

- Entries about a run say which continuous mission and which run they belong
  to. A continuous mission that stopped itself is its own entry, ranked with
  setup problems and answered for the reader like every other.

### Surfaces

- Schedules, under Work: what runs on its own, when it runs next, how its
  runs went, and the controls a person may use. Each run's mission page
  links back to its schedule. The rule composer asks when a rule applies.

## 2.1 - The intelligence layer

Skills stop being something a model may or may not remember to use, and become
the thing the server decides, pins and can explain.

### Skill resolution

- Which skill a step follows is settled on the server by a deterministic
  ranking over the skills that apply and the agents that could take the step
  (`packages/skills/src/resolver.ts`). The planner's answer is one signal among
  several, worth 200 points; a person naming a skill is worth 1000; what the
  step says it needs, the words it uses and the skill's own category and
  description make up the rest. The same inputs always give the same answer.
- A skill is only a candidate when an agent holds it and already has every tool
  and capability it needs. Nothing can invent a skill, a scope, an owner, a
  tool grant or a capability.
- Every selection carries its reasons in a person's words, recorded on the step
  and shown in the execution room. When no skill was chosen, the step says why.
- A planner suggestion no longer changes a step's requirements by itself; the
  skill the server chooses does.

### Version pinning

- Every published version of a skill is kept, unchanged, in `skill_versions`.
  System skills are recorded the first time an organization pins one.
- A step runs the version it was planned around. Publishing a new version
  changes what later missions do, not what a mission is part way through.
- A pinned version that is no longer on record is never swapped for a different
  one, and a skill archived since planning is not run.
- A step that its agent can no longer follow says which tool or capability is
  missing, by name.

### Approvals

- An approval is granted against a **proposal**: the agent, the skill and its
  pinned version, the tools, the external writes and the mission, written down
  in `action_proposals` before anyone is asked, with a sha-256 fingerprint.
- The approval points at that proposal and shows the sentence it produced, so
  a decision is about one concrete action rather than about a step in general.
- If the action changes before the step runs, the decision no longer covers it:
  nothing runs, `approval.superseded` is recorded, and a fresh approval is
  raised against the action as it now stands.

### Surfaces

- The execution room shows the skill a step followed, the version it was pinned
  to, the reasons it was chosen, and the version that actually ran.
- The approvals page leads with what is being approved, and says the decision
  is bound to it.
- The skills catalogue says which skills the workforce can actually use, and
  filters by that: "Ledger can run it" rather than "held by Ledger".

### Performance

- The browser is shipped only the Supabase auth client rather than the whole
  SDK, since signing in is all it does with Supabase. The main bundle falls
  from 835 kB to 720 kB (241 kB to 209 kB gzipped).


## 2.0 - UNIOFFICE 2.0

UNIOFFICE becomes an operating system with a workforce that knows how to do
things, a product that knows what it can do, and a database closed to
everything but the API.

### Skills

- A first-class skill model: reusable operating procedures with inputs,
  outputs, required tools and capabilities, an approval setting and a memory
  setting. 22 system skills ship across engineering, research, finance, people
  and communication.
- Organization and workspace skills, with precedence workspace > organization >
  system, versioned changes that need the version seen, and draft, active and
  archived states.
- Agents hold skills; assignment is refused unless the agent already holds every
  required tool and capability.
- The planner may name a skill for a step; delegation routes it only to agents
  holding the skill; the server records the applied skill; governance holds
  steps whose skill requires approval; the runtime hands the procedure to the
  model as delimited configuration that cannot change rules.
- Skills catalogue, skill detail and editor, skills on agent profiles and in the
  execution room.

### Features

- A feature registry and `GET /features`: each surface's area, path,
  permission, dependencies and live status (available, limited, needs
  configuration). Navigation, breadcrumb and command palette are built from it.

### Interface

- Design tokens for 2.0: type scale, spacing, elevation, motion, focus, layering
  and density; tokens bridged into Tailwind; every raw colour in pages and
  stylesheets replaced with a token; uniform keyboard focus; reduced motion.
- A rebuilt shell organised as Command, Work, Workforce, Knowledge and Company,
  with feature status in the rail, an offline banner and honest connection state.
- Command Center shows what each agent is doing.
- Approvals show what is being approved, why, who is waiting, the tools and risk,
  what approving and rejecting do, and whether you may decide - as the server
  says.
- Company Brain says why each piece of knowledge exists and marks unreviewed
  system-derived knowledge as a claim.
- Readable errors everywhere; permission-denied, offline and stale-data states;
  pages keep the last good data when a refresh fails.

### Platform

- React 19.3, Vite 8.3, Vitest 5.0.1, supabase-js 2.116, Fastify 5.12.4, React
  Router 7.18.4, ESLint 10.10, typescript-eslint 8.70, TypeScript 6.0 across the
  workspace, Node 24 declared.
- Pages load on demand: the entry bundle fell from 1,163 kB to 828 kB.
- Polling pauses in hidden tabs and resumes on return.

### Database and security

- Browser roles hold no privileges on any table, sequence or function, including
  objects created later; 13 foreign keys indexed.
- `supabase/checks/posture.sql` verifies RLS, policies, grants and indexes.
- Skills: strict validation, injection-safe rendering, cross-organization
  isolation, governance floors - with tests for each.

### Naming

- The product is UNIOFFICE; the old "UNI-OFFICE" spelling is retired from the
  interface, prompts and messages.
