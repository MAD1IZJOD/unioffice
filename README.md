# UNI-OFFICE

An AI-native company operating system: you give the company an objective, it
plans the work, routes each task to the specialist agent holding the right
tools, executes it, and keeps consequential steps behind your approval.

## Running locally

All three processes read `.env` at the repository root - copy `.env.example`
and fill in Supabase and Ollama. Then, from the repository root:

```
pnpm dev      # starts the API, the worker and the web app together
```

`pnpm dev` runs each package's `dev` script through turbo, so the worker is
started alongside the API. Without a worker, missions are planned and put on
the queue but never executed - Mission Control reports them as stalled.

To run one process on its own, in its own terminal:

```
pnpm api      # HTTP API on http://127.0.0.1:4000
pnpm worker   # executes queued work
pnpm web      # web app on http://localhost:5173
```

Ollama must be running with the model named by `OLLAMA_MODEL`.

## Signing in, members and roles

Everyone signs in through Supabase Auth - with Google, or with a one-time link
sent by email. No password is ever set or asked for by the app. Signing in only
says who someone is; what they may see and do comes from their membership in an
organization, which only the API reads and writes.

To turn on Google sign-in, create an OAuth client in Google Cloud (type "Web
application") and add Supabase's callback URL,
`https://<project-ref>.supabase.co/auth/v1/callback`, as an authorized redirect
URI. Then in Supabase, under Authentication -> Sign In / Providers -> Google,
paste the client id and secret, and add `http://localhost:5173` under
Authentication -> URL Configuration -> Redirect URLs.

The first owner of an organization is made from a terminal:

```
pnpm owner:claim you@company.com                        # the development organization
pnpm owner:claim you@company.com --organization <slug>
```

If that address has already signed in, it becomes the owner at once; if not,
the owner role waits for it and turns into access the first time someone signs
in with that confirmed address. It refuses an organization that already has an
active owner - from then on, owners add people from the Members page.

| Role | May |
| --- | --- |
| Owner | Everything, including making and removing other owners |
| Admin | Run the organization: members and viewers, workspaces, agents and their tool grants, policies, knowledge curation. Never owners or other admins |
| Member | Open, run, retry and cancel missions; decide steps the planner raised; propose knowledge (it waits for review) |
| Viewer | See what they are given. Change nothing |

Owners and admins reach every workspace. Members and viewers see company-wide
missions and knowledge, plus the workspaces they are granted - as "can see" or
"can work". A mission, approval or entry in a workspace someone was not given
reads as not found. A step a governance policy requires a person for is decided
by an owner or admin; a member decides only the steps the planner itself raised.

Every role check happens in the API against the membership as it is at that
moment: a role change, suspension or removed grant applies to the very next
request, changes that start, stop or decide something re-read it immediately
before acting, and the live channel re-checks it every twenty seconds. The web
app hides what a role cannot do, but that is only presentation.

## How execution works

The API never executes work itself. Creating, approving or retrying an
objective puts a **durable job** on a Supabase-backed queue, and a worker
process claims and executes it.

```
objective -> plan -> execution_jobs row -> worker claims -> agents + tools
          -> tasks, artifacts, memories, events
```

This means:

- Execution survives an API restart. The job is a row, not a promise in
  memory.
- Work is never executed twice. A partial unique index allows at most one
  queued or running job per work item, so a double-click, a retried request or
  two code paths asking at once all resolve to the same job.
- Two workers never claim the same job. Claiming is a compare-and-swap on the
  status and attempt count, so exactly one wins.
- A worker that dies does not strand its work. Its lease expires and another
  worker requeues and finishes the job, rather than the work being failed.

The queue orchestrates execution only. Works, tasks, artifacts, memories,
approvals and events remain the source of truth for business state.

### Worker configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `WORKER_POLL_INTERVAL_MS` | `2000` | Wait after finding nothing to do |
| `WORKER_LEASE_MS` | `600000` | How long a claim is held before it is considered abandoned |
| `WORKER_CONCURRENCY` | `2` | Jobs one worker runs at once |

The lease must comfortably outlast a real objective, which takes minutes, or a
healthy worker would lose its own job to recovery mid-run.

You can run more than one worker; they will share the queue safely.

## The workforce

Six agents are seeded into the development organization. The names are product
codenames; what actually routes work is the capability set and the tool grant
beside each one.

| Agent | Role | Capabilities | Tools |
| --- | --- | --- | --- |
| Tyrion | Orchestration - plans the work and routes it | planning, coordination, decision_support | none |
| Tony | Engineering - builds and transforms | coding, technical_design, data_transformation | calculator, datetime, json_transform |
| Harvey | Quantitative - measures and calculates | calculation, financial_analysis, decision_support | calculator, datetime |
| Mike | Research - reads, synthesises, writes | research, synthesis, writing | datetime, json_transform |
| Jamie | Operations - designs how the work runs | people_operations, process_design, writing | datetime |
| Peter | Communication - turns work into messages | communication, stakeholder_messaging, writing | datetime |

The seed reconciles an existing row against this table on every boot, including
its name, so changing the table renames the agent rather than creating a second
one.

## The web app

`apps/web` reads the API and nothing else - there is no mock data anywhere in
it, and a surface with nothing to show says so rather than inventing a row.

- `lib/api.ts` - typed fetch client. Every type mirrors a real response.
- `lib/attention.ts` - the single definition of "what needs a person", shared
  by the rail, the header control and the Command Center opening.
- `lib/workforce.ts` - derives an agent's discipline from the capabilities the
  delegator routes on, which is what gives each one its own mark and role line.
- `lib/statement.ts` - the company's own account of its state, rendered as the
  largest type on the Command Center.
- `components/AgentMark.tsx` - a generated figure per discipline. A member per
  capability, a filled node per authorized tool, so an agent holding no tools
  draws as visibly hollow.
- `styles/system.css` - tokens, tones and shared pieces.
- `styles/surfaces.css` - each screen's own composition.

Black carries the interface. Blue means the system is working; red means a
person is needed or something broke. Nothing is coloured decoratively.

## Known limitations

These are real gaps, listed so the UI does not have to pretend otherwise.

- **The planner can invent an unroutable capability.** It is given the union of
  capabilities the available agents actually hold, but it sometimes emits one
  outside that vocabulary (`mathematical_analysis` rather than `calculation`).
  The delegator then correctly refuses the task and the run fails with "No
  eligible agent is authorized for...". Retry replans and usually succeeds.
- **Memory retrieval is keyword and importance based.** There are no
  embeddings and no semantic similarity, and the Company Brain says so rather
  than drawing a graph it cannot back up.
- **Agents have no internet access.** The only tools that exist are the three
  in the registry, so "research" means working over supplied context and
  company memory.
- **There is no organization switcher yet.** Someone who belongs to several
  organizations opens the oldest one they are active in; the choice is kept in
  the browser but there is no control to change it.
- **Invitations send no email.** An invited person gets in the next time they
  sign in with that address; telling them is up to whoever invited them.
- **Narrowed lists can come back short.** For a member or viewer, activity and
  artifacts are narrowed to their workspaces after a bounded read, so a page of
  them can hold fewer rows than asked for.

## Checks

```
pnpm typecheck
pnpm test
pnpm --filter web lint
pnpm --filter web build
```

## Security

Supabase service-role credentials are used by the API and worker only. The web
app holds the public anon key, uses it only to sign people in, and talks to the
API over HTTP with the signed-in user's access token.

- Every table has row-level security enabled and forced with no policies, so
  the anon key can read and write nothing - including memberships.
- The API verifies each token with the Supabase auth server, so a signed-out or
  deleted user stops working. It never trusts an organization, role, requester
  or decider named in a request.
- The browser's live channel is opened with a single-use ticket that expires in
  a minute, so no access token is ever put in a URL.
- An organization can never be left without an active owner: the database
  refuses the change, whatever order concurrent requests land in.
- Membership changes are recorded in the event log as `member.*` and
  `workspace.access_*` events, naming the member rather than their address.
