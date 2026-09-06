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
