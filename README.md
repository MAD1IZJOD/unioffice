# UNI-OFFICE

An AI-native company operating system: you give the company an objective, it
plans the work, routes each task to the specialist agent holding the right
tools, executes it, and keeps consequential steps behind your approval.

## Running locally

Three processes, each in its own terminal. All of them read `.env` at the
repository root - copy `.env.example` and fill in Supabase and Ollama.

```
pnpm api      # HTTP API on http://127.0.0.1:4000
pnpm worker   # executes queued work
pnpm web      # web app on http://127.0.0.1:5173
```

Ollama must be running with the model named by `OLLAMA_MODEL`.

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
- **There is no auth.** Approval decisions are attributed to a seeded requester
  id, and there is no organization switcher - the web app targets the seeded
  development organization unless `VITE_ORGANIZATION_ID` says otherwise.
- **A failure stays in the attention queue until it is retried.** There is no
  "acknowledged" state on a work row, so a failure you have decided to ignore
  cannot be dismissed.
- **Organization and Governance have no backend.** Both routes deliberately
  show what belongs there instead of a convincing mock.

## Checks

```
pnpm typecheck
pnpm test
pnpm --filter web lint
pnpm --filter web build
```

## Security

Supabase service-role credentials are used by the API and worker only. The web
app talks to the API over HTTP and never receives them.
