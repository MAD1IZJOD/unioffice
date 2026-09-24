# UNIOFFICE 2.1

An AI-native operating system for companies: you give the company an
objective, it plans the work, decides which of the company's own procedures
each step follows, routes it to an agent that holds that skill and the tools it
needs, executes it under governance against the exact version it was planned
around, keeps what it learns, and stops for a person wherever a person is
required - on a written-down proposal they can read, not on a step in the
abstract.

Documentation lives in [`docs/`](docs/architecture/README.md): the
[system overview](docs/architecture/system-overview.md),
[skills](docs/skills/README.md), [features](docs/product/features.md),
[governance and approvals](docs/governance/README.md),
[the Company Brain](docs/memory/README.md), [agents](docs/agents/agent-model.md),
[workflows](docs/workflows/workflow-model.md) and
[deployment](docs/deployment/README.md). Release notes are in
[CHANGELOG.md](CHANGELOG.md).

## Running locally

All three processes read `.env` at the repository root - copy `.env.example`
and fill in Supabase and Ollama. Then, from the repository root:

```
pnpm dev      # starts the API, the worker and the web app together
```

`pnpm dev` runs each package's `dev` script through turbo, so the worker is
started alongside the API. Without a worker, missions are planned and put on
the queue but never executed - Mission Control reports them as stalled.

The worker also starts continuous missions' runs as they come due. What is
due is read from the database, never a timer in a browser, so schedules run
with every tab closed; an occurrence that fell due while no worker was
running starts once when one next comes up.

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

### Workforce

The Workforce page (`/workforce`) answers who is working for the organization.
It is served by `GET /workforce` and `GET /workforce/:agentId`, both read by
`WorkforceService` from the same lean task, mission, event and artifact reads
Mission Control uses, so the two never disagree about who is doing what.

- **Status** is only what the backend records: *working* (a step is running),
  *waiting on a decision* (a step is held for an approval), *available*,
  *paused* and *unavailable* (the agent's own status). Paused and unavailable
  agents are given no new steps.
- **Current work** names the mission and the step. **Outcomes** are the agent's
  finished and failed steps over the most recently active missions.
- **A profile** adds capabilities, tools, what governance lets the agent do with
  each tool it holds (a grant is not a permission), the enforced policies that
  reach it, its work history, what it produced and a record built from its
  events. Owners and admins can pause, resume and configure it.

Everything is scoped like the rest of the API: another organization's agent,
or one working in a workspace the caller was not given, reads as not found; a
mission the caller cannot open is never named, only that the agent is busy.
An agent's model instructions, task outputs, tool inputs and raw failure text
never leave the server - on the workforce, or anywhere else an agent is named.

## Skills

A tool is something an agent can execute; a skill is how a kind of work is done
well - the procedure, what it works from and produces, the tools and
capabilities it needs, and whether each step needs a person. 22 system skills
ship with UNIOFFICE; owners and admins adapt them or write their own for the
company or one workspace (Workforce -> Skills).

- A skill grants nothing. An agent can only be assigned a skill whose tools and
  capabilities it already holds.
- The planner may name a skill for a step, and the step goes only to an agent
  holding it. A skill set to require approval holds every step that follows it
  for an owner or admin; no policy can lower that.
- The procedure reaches the model as labelled configuration that cannot change
  its rules, tools or approvals.

See [docs/skills](docs/skills/README.md).

## Connections

Settings -> Connections is where the organization connects external systems.
Two are built in: **GitHub** and **Google Drive**. A connection belongs to the
organization - company-wide, or narrowed to one workspace - never to a person
or an agent.

```
organization -> connection -> provider -> allowed capabilities
             -> agent holds the tool -> governance -> external action
```

### Setting up the providers

Everything is configured in the API's environment (see `.env.example`); the
browser never sees any of it. Until a provider is configured the page says so
and offers nothing to click.

1. Generate an encryption key and set `CONNECT_ENCRYPTION_KEY`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
   It seals every stored token. Losing or changing it makes existing
   connections unreadable - they then need reconnecting.
2. **GitHub**: create an OAuth App (GitHub -> Settings -> Developer settings ->
   OAuth Apps). Authorization callback URL:
   `<API_URL>/connections/oauth/github/callback` (locally
   `http://localhost:4000/connections/oauth/github/callback`). Set
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
3. **Google Drive**: in Google Cloud, enable the Google Drive API, configure the
   OAuth consent screen (add yourself as a test user while it is in testing),
   and create an OAuth client of type "Web application" with the redirect URI
   `<API_URL>/connections/oauth/google_drive/callback`. Set
   `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`. This is a separate
   client from the one Supabase uses for sign-in.
4. Restart the API and the worker - both read the same configuration, because
   the worker is what runs agents' tool calls.

### Scopes

| Provider | Scope | Why |
| --- | --- | --- |
| GitHub | `public_repo` (default) or `repo` | OAuth Apps have no read-only repository scope. `public_repo` covers public repositories; `repo` is chosen explicitly at connect time for private ones |
| Google Drive | `drive.readonly` | List, search, metadata and content. Nothing can be created, changed, shared or deleted |

What agents may do is narrower than the scope and decided here, per
connection: a new connection allows **reads only**. An owner or admin turns on
`github.write` (open issues, create branches, open pull requests) on the
connection's page. Drive has no write capability at all.

### Lifecycle

- **Connect**: an owner or admin starts it. The API creates a random, single-use
  `state` (stored only as a SHA-256 hash, tied to that person and organization,
  expiring in ten minutes) and a PKCE verifier (stored sealed), and returns the
  provider's consent URL. The provider sends the browser back to the API, which
  consumes the state, re-checks that the person still may manage connections,
  exchanges the code server-side, and redirects to the connection's page with
  no token, code or provider message in the address.
- **Use**: when a tool runs, the API or worker finds the live connection that
  reaches the mission (the workspace's own first, then the company-wide one),
  checks it is active and allows the capability, opens the credentials for that
  one call, and refreshes Google tokens that are about to expire. Last use is
  recorded coarsely.
- **Needs reconnecting**: a token the provider refuses marks the connection;
  agents get a clear failure and nothing is retried until someone reconnects.
- **Disconnect**: revokes the authorization at the provider, erases the stored
  credentials in the same write that marks the connection revoked, and stops
  every later tool call, including ones already queued. The record and its
  events stay as history. If the provider cannot confirm the revoke, the page
  says so.

### How agents use a connection

Connecting a system gives no agent anything. A call goes through, in order:

1. the agent's own tool grant (`github_issue`, `drive_read_file`, ...), set on
   its profile;
2. for a write, a person's approval of the step for that exact tool - every
   step that needs a GitHub write waits for an **owner or admin**, whatever the
   policies say, and a deny policy still wins;
3. governance for the tool call;
4. a live connection that reaches the mission and allows the capability;
5. per-connection rate limiting (60 calls a minute per process) and the
   provider's own limits.

Each approved write runs at most once in its step. The agent's profile lists
the connected systems it holds tools for and whether it can really use each.

Tools: `github_repository`, `github_branches`, `github_issues`, `github_issue`,
`github_pull_requests`, `github_pull_request`, `github_commits`,
`github_create_issue`, `github_create_branch`, `github_create_pull_request`,
`drive_list_files`, `drive_search`, `drive_file_metadata`, `drive_read_file`.
Reads are bounded - one page of at most 30 (GitHub) or 25 (Drive) items, issue
and pull request bodies cut to 6,000 characters, documents read as text only
(Docs, Sheets as CSV, Slides, plain text) and cut in the stream at 256 KB and
8,000 characters. PDFs and binaries are refused rather than read.

### Security model

- Tokens, client secrets, authorization codes and PKCE verifiers never reach
  the browser, the event log, artifacts, the Company Brain or a log line
  (callback query values are redacted from request logs).
- Credentials are sealed with AES-256-GCM and bound to their connection, so an
  envelope copied onto another row does not open. The `connections` and
  `connection_oauth_states` tables have row-level security forced with no
  policies.
- Another organization's connection, or one for a workspace the caller was not
  given, reads as not found. Connection routes refuse fields they do not take.
- External content is untrusted. It is stripped of invisible and
  direction-changing characters and of the runtime's own tool-call syntax,
  bounded, and handed to the model marked as data written by people outside the
  company. Nothing it says can grant a tool, approve a step or change a
  capability - those are decided by the server from the agent's row and the
  step's recorded approval. Tests cover injected GitHub issues and Drive
  documents.
- An external call is audited by what happened - `external.read` "Drive
  document accessed", `external.write` "GitHub pull request created", with the
  repository or file id - never by what was read or written. A step that read
  external content is not mined for company knowledge automatically; its answer
  stays in the step and its artifact, with its sources.
- Provider errors become fixed messages; a provider's own error text is never
  passed on.

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
- **Semantic recall needs a local embedding model.** Without one, knowledge
  is recalled by keyword, importance and recency only, and the Company Brain
  feature reports itself as limited.
- **Stored workflows cannot be edited or run yet.** A mission's plan is its
  workflow; the workflow tables exist for reusable workflows to come.
- **A skill's approval covers the step.** As with external writes, a person
  approves the step that follows the skill, before the agent writes its answer.
- **Agents have no general internet access.** Beyond the three local tools,
  they reach only the GitHub and Google Drive connections the organization made,
  through tools they were granted.
- **Connection rate limits are per process.** The API and each worker count
  calls separately; the provider's own limit is the one that cannot be exceeded.
- **An approval covers the step, not the exact text.** A person approves a step
  to use a GitHub write tool before the agent writes the issue or pull request,
  so what is approved is the step's intent, bounded to one call of that tool.
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
pnpm lint
pnpm build
```

The database posture - RLS enabled and forced, no policies, no privileges for
browser roles, indexed foreign keys - is checked against the linked project
with:

```
pnpm exec supabase db query --linked -f supabase/checks/posture.sql
```

It returns one row per violation; no rows is the expected state.

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
