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
extra configuration. Allow at least 120 seconds for a request: planning runs
inside `POST /work/:id/plan` and has been measured at 60-90 seconds.

Sizing is decided by the model, not by this code: the two Node processes sit
around 100-150 MB each, while `qwen3:8b` wants roughly 8-10 GB of RAM on CPU.
Pointing `OLLAMA_BASE_URL` at a machine or service that hosts the model
elsewhere needs no code change at all.

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
