# Deployment

Two domains, two different things.

| Domain | What it serves | Where it comes from |
| --- | --- | --- |
| `unioffice.online` | The public marketing site | Deployed separately, outside this repository |
| `unioffice.pro` | UNIOFFICE itself | `apps/web` in this repository |

The marketing site's only job in this arrangement is to send people to
`https://unioffice.pro` with a clear call to action - "Enter UNIOFFICE". It
needs nothing from this repository and shares no code with it.

Everything behind `unioffice.pro` is the existing application. There is one
API, one database and one Supabase project; the browser talks to the API, and
the API decides what anyone may see or do.

## What the browser is given

Only two things, both public:

| Variable | Why the browser may hold it |
| --- | --- |
| `VITE_SUPABASE_URL` | The project's address. Public. |
| `VITE_SUPABASE_ANON_KEY` | The anon key. It can do nothing row-level security does not allow, and company data never comes from it - it signs people in and nothing else. |

And two addresses, which are configuration rather than credentials:

| Variable | Value in production |
| --- | --- |
| `VITE_API_URL` | Wherever the API is served from, e.g. `https://api.unioffice.pro` |
| `VITE_APP_ORIGIN` | `https://unioffice.pro` |

The service-role key, the connection encryption key and every provider secret
are read by the API only. They are never named with a `VITE_` prefix, never
reach a build of the web app, and must never be set on the web project.

`VITE_API_URL` has no production default on purpose. A build without it that
is served from a real domain says so plainly instead of quietly sending each
visitor's browser to their own machine.

## The web app on Vercel

The application is a static single-page build. There is no server-side
rendering and no API route in it.

| Setting | Value |
| --- | --- |
| Root directory | `apps/web` |
| Framework preset | Vite |
| Build command | `pnpm build` |
| Output directory | `dist` |
| Install command | default (pnpm, from the workspace root) |

`apps/web/vercel.json` holds the rest: every path that is not a built asset is
served `index.html`, so a link straight to `/missions/<id>` opens the mission
instead of a 404; assets are cached forever because their names contain their
hash, and `index.html` never is; and the responses carry `nosniff`, a strict
referrer policy, a closed permissions policy, and `frame-ancestors 'none'` so
the application cannot be framed by another site. An approval is a click that
matters, and clickjacking it is exactly the attack that would be worth
mounting.

A full content security policy is deliberately not set yet: `connect-src`
cannot be written correctly until the API's own origin is fixed. Add it in the
same file once that is decided.

## The API and the worker

Two long-lived Node processes. The API is Fastify and answers the browser; the
worker takes objectives off the durable queue and runs them. Neither is a
serverless function, and neither belongs on Vercel.

```
pnpm install                          # dev dependencies included; see below
pnpm --filter @unioffice/api start
pnpm --filter @unioffice/worker start
```

Both run the TypeScript entrypoint through `tsx`, which is why `tsx` is a
dependency of both apps rather than a tool of the workspace: these processes
need it to start, so an install that drops development dependencies still
produces a host that works.

They share one configuration and can be started, stopped and restarted
independently. Jobs are claimed with a conditional update, so more than one
worker is safe; the API is not, because stream tickets and rate limiting are
per-process - one API instance is the supported shape.

### Rolling out execution claim guards

Stop the existing workers and apply the execution lease migrations in order
before starting the API and workers from the new revision. A worker verifies its claim
before running a job and before each provider request. PostgreSQL also checks
the claim in the same transaction as each guarded worker write. A rejected
claim or heartbeat that returns no row cancels the attempt. A heartbeat
transport error leaves the attempt running while ownership is checked again.

Cancellation stops further provider requests and discards late results. An
external write already accepted by the provider may still take effect. Check
the provider before repeating an uncertain external write.

The queue owns lease recovery. A recoverable lease goes back to the queue.
When the last lease expires, one database transaction fails that exact job
attempt, closes the unfinished mission and its interrupted steps, and records
the failure event. Finished missions and missions awaiting a person keep their
recorded state.

API startup handles only abandoned work with no queued or running job. Its
database transaction rechecks the mission's age and status and whether the
queue owns it before changing tasks or mission state. The worker still owns
recovery for an expired running job.

### Listening

`HOST` decides the address. It defaults to `127.0.0.1`, so a development
machine is never quietly serving the network, and a deployment whose reverse
proxy is on the same host keeps that default. A container has to be reachable
from outside itself:

```
HOST=0.0.0.0
API_PORT=4000
```

Anything that is not a bare address - a scheme, a path, whitespace - is
refused at startup rather than becoming a server nobody can reach.

### Origins

```
API_CORS_ORIGINS=https://unioffice.pro,https://www.unioffice.pro
WEB_URL=https://unioffice.pro
API_URL=https://api.unioffice.pro
```

`API_CORS_ORIGINS` is an explicit list. There is no wildcard and no pattern
matching; an origin that is not listed gets no CORS header at all. Keep the
localhost entries in the development `.env` and out of production.

### Server-only configuration

Set on the API and the worker, never on the web project, and never with a
`VITE_` prefix.

| Variable | Production value |
| --- | --- |
| `SUPABASE_URL` | the project URL (required) |
| `SUPABASE_SERVICE_ROLE_KEY` | the service-role key (required) - **secret** |
| `HOST` | `127.0.0.1` behind a local proxy, `0.0.0.0` in a container |
| `API_PORT` | `4000` |
| `API_URL` | `https://api.unioffice.pro` |
| `WEB_URL` | `https://unioffice.pro` |
| `API_CORS_ORIGINS` | `https://unioffice.pro,https://www.unioffice.pro` |
| `OLLAMA_BASE_URL` | where the model is served |
| `OLLAMA_MODEL` | `qwen3:8b` |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text`, or empty for keyword recall only |
| `SEED_DEVELOPMENT_WORKFORCE` | **`false`** |
| `WORKER_POLL_INTERVAL_MS`, `WORKER_LEASE_MS`, `WORKER_CONCURRENCY` | defaults are fine to start |
| `EXECUTION_STALE_AFTER_MINUTES`, `STREAM_TAIL_INTERVAL_MS` | defaults are fine to start |

`SEED_DEVELOPMENT_WORKFORCE` must be `false` in production. Left `true`, the
API creates the development organization and its demo workforce in the real
database on every start.

Only if connections are enabled: `CONNECT_ENCRYPTION_KEY` (required once
either provider is set), `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`,
`GOOGLE_DRIVE_CLIENT_ID` / `GOOGLE_DRIVE_CLIENT_SECRET`. All secret.

Configuration is read from the environment. The repository-root `.env` is
loaded when it exists and is ignored when it does not, so a host that sets
real environment variables needs no file; `UNIOFFICE_ENV_FILE` points at one
elsewhere if you prefer.

### Is it up, and can it work

| Endpoint | Question | Answer |
| --- | --- | --- |
| `GET /health` | Is this process alive? | Always 200 while it is running. Asks nothing of Supabase, the model or the queue. |
| `GET /readiness` | Can it do its job? | 200 with what it found, or 503 naming what is down. |

Point a process manager's restart check at `/health` and a load balancer's
health check at `/readiness`. They are deliberately different questions:
restarting the API because Supabase is briefly unreachable turns one outage
into two.

The model backend is **reported but not required** by readiness. One instance
serves both reading a mission and planning one, so refusing all traffic while
the model restarts would take the whole product down to protect the part that
needs it. While `ollama` reads `unreachable`, everything except planning and
execution keeps working, and planning fails with its own message.

Neither endpoint needs a session, and neither returns anything about the
company.

### A simple host

One machine running the API, the worker, Ollama and Caddy is enough for the
first testers, and keeps `OLLAMA_BASE_URL` on loopback.

```
unioffice.pro      -> Vercel (the web app)
api.unioffice.pro  -> Caddy -> 127.0.0.1:4000 (the API)
                      worker (no inbound port)
                      Ollama on 127.0.0.1:11434
```

Caddy terminates TLS and does not buffer responses, so the live channel works
through it unchanged. The stream already sends `x-accel-buffering: no` and its
own keep-alive frames, so an nginx in front of it would also work without
extra configuration.

No request has to stay open for the length of a plan. The web app starts a
mission with `POST /work/:id/launch`, which answers `202` within a couple of
seconds; the server then plans the mission (measured at 100-120 seconds on
`qwen3:8b`, cold model included) and queues it itself, and the room follows
progress from the mission's own state. This matters behind Cloudflare, whose
documented proxy timeout is 100 seconds, and it means a closed tab or a
dropped connection can no longer leave a mission planned but never run.

The older `POST /work/:id/plan` still exists and still holds the request for
the whole plan. Only the room's "Build the plan" fallback uses it, and it
refuses while a launch is already planning the same mission.

Sizing is decided by the model, not by this code: the two Node processes sit
around 100-150 MB each, while `qwen3:8b` wants roughly 8-10 GB of RAM on CPU.
Pointing `OLLAMA_BASE_URL` at a machine or service that hosts the model
elsewhere needs no code change at all.


## Verification on 7 November 2026

The linked hosted migration ledger was read directly. All three migrations below
are pending; their service RPCs are absent. The migration dry run lists exactly
this sequence:

1. `20261106000000_guard_execution_attempt_writes.sql`
2. `20261106000100_fail_exhausted_execution_jobs.sql`
3. `20261106000200_protect_queued_work_during_startup.sql`

The guard checks ownership in the transaction that writes task results,
artifacts and events. Unscoped API writes and human approval decisions remain
permitted. Exhaustion closes the queue job and unfinished mission together;
startup reconciliation excludes queued and running jobs. Repository regression
tests and isolated PostgreSQL checks cover these cases. They do not establish
that the hosted database has these protections.

The Windows origin has no API listener on port 4000 and no UNIOFFICE API or
worker process. Cloudflared readiness returns 200, but public API health and
`/me` return 502. The tunnel is up; its API origin is absent. No new job claim,
authenticated mission or replacement-worker recovery was verified.

Linked database management access works. The hosted backup list is empty.
The CLI dump path fails temporary-role authentication; separate verified-TLS
`pg_dump` attempts timed out before producing an archive. Temporary backup
logins were removed. No hosted migration or business-data mutation was made.

The host account is not an administrator. No UNIOFFICE service or scheduled task
was found. The repository's local environment is configured for development,
including workforce seeding. Starting it against the hosted project would not
be a safe production rollout.

### Finish the rollout

Run from the repository root on the approved deployment host. Keep both API and
worker stopped until a verified backup exists and all migrations are applied.

1. Provision PostgreSQL client tools and a trusted database connection. Set
   `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
   `PGSSLMODE=verify-full` and `PGSSLROOTCERT` through the host's secret
   configuration. Use the direct connection or session pooler, not transaction
   pooling. Do not print credentials. Create and inspect a custom archive:

   ```powershell
   pg_dump --format=custom --file=unioffice-before-lease-guards.dump
   if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
   pg_restore --list unioffice-before-lease-guards.dump
   if ($LASTEXITCODE -ne 0) { throw 'Backup archive is unreadable' }
   Get-FileHash unioffice-before-lease-guards.dump -Algorithm SHA256
   ```

   Restore the archive into an isolated database using equivalent required
   roles and extensions. Verify schema and row counts. Secure the archive
   because it contains company and authentication data. Do not proceed if the
   archive cannot be restored.

2. Stop old API and worker instances through their supervisor. Verify the
   deployment checkout is clean `main` and matches `origin/main`. With the
   linked project's database password provided securely if requested:

   ```powershell
   pnpm exec supabase migration list --linked
   pnpm exec supabase db push --linked --dry-run
   # Continue only if the list is exactly the three migrations above.
   pnpm exec supabase db push --linked
   if ($LASTEXITCODE -ne 0) { throw 'Migration application failed' }
   pnpm exec supabase migration list --linked
   ```

3. Provision a separate production environment file. Set `NODE_ENV=production`,
   `SEED_DEVELOPMENT_WORKFORCE=false`, the production origins from the table
   above, and the existing database/model/provider secrets. Set
   `UNIOFFICE_ENV_FILE` to that absolute file path in each supervisor entry.
   The current development file must not be used. Confirm the model is
   reachable from the worker account.

4. Register API and worker as independently restartable processes with the
   host's approved Windows supervisor. This repository does not supply an
   installed supervisor configuration; selecting and provisioning it remains
   a deployment step. Use the repository root as the working directory and
   these separate entrypoints:

   ```powershell
   pnpm --filter @unioffice/api start
   pnpm --filter @unioffice/worker start
   ```

   Retain separate logs, restart-on-failure settings and graceful-stop support.
   Confirm both processes survive a supervisor restart. Keep the existing
   tunnel's origin at `http://127.0.0.1:4000`; no tunnel change is needed to
   repair the absent listener.

5. Verify fresh local and public health/readiness, then use a newly signed-in
   user's access token held in an environment variable:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:4000/health
   Invoke-RestMethod http://127.0.0.1:4000/readiness
   Invoke-RestMethod https://api.unioffice.pro/health
   Invoke-RestMethod https://api.unioffice.pro/readiness
   Invoke-RestMethod https://api.unioffice.pro/me -Headers @{
     Authorization = "Bearer $env:UNIOFFICE_SMOKE_ACCESS_TOKEN"
   }
   ```

   Run a fresh authenticated mission with two dependent tasks and a real tool.
   Check its queue claim, task outputs, artifacts, events and terminal status
   in the hosted database. Verify a human approval/resume flow. Interrupt a
   worker during a fresh attempt, let its lease expire, start its replacement,
   and verify recovery and rejection of stale-attempt writes. Inspect the
   provider before repeating an external action whose outcome is uncertain.

The frontend can deploy independently. A successful static build or public
sign-in page does not establish that authenticated operations or execution work.

## Signing in

Sign-in is Supabase Auth: Google, or a one-time email link. Neither sets a
password. The application asks to be returned to an origin it recognises -
`VITE_APP_ORIGIN`, `https://unioffice.pro`, or localhost in development - and
never to whatever host happens to be serving the page
(`apps/web/src/lib/origins.ts`).

Supabase holds the authoritative list, and it is set in the dashboard, not in
this repository. `supabase/config.toml` configures the local CLI stack only;
`supabase db push` does not touch a hosted project's auth settings.

**Authentication → URL Configuration**, on the hosted project:

| Setting | Value |
| --- | --- |
| Site URL | `https://unioffice.pro` |
| Redirect URLs | `https://unioffice.pro/**`, `https://www.unioffice.pro/**`, `http://localhost:5173/**` |

Without these, Google and the email link both complete and then return the
person to the old site URL, which looks like sign-in silently failing.

## Adding a tester

There is no invitation email yet, and this task did not add one. The flow that
does work:

1. An owner or admin opens **Company → Members** and adds the tester's email
   address with a role. The member is created with status `invited`.
2. You tell the tester - by whatever means you already use - that they have
   access and should go to `https://unioffice.pro`.
3. The tester signs in with **that same email address**, using Google or the
   email link.
4. On their first request the server matches the confirmed address to the
   waiting invitation, links it to their account, and the membership becomes
   active (`apps/api/src/access/access-resolver.ts`).

An unconfirmed address cannot pick up an invitation, because an unconfirmed
address proves nothing about who owns it.

A tester who already belongs to another organization lands in the oldest one
they are active in, and switches to yours from the organization picker. That
is existing behaviour, not a fault.

## Domains

Attach each domain in the Vercel project that serves it, and use the DNS
records Vercel then shows for that specific domain. They are per-project and
are not guessed here. The registrar account and the Supabase account are
different accounts; only the registrar's owner can add the records.
