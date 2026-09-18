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

## The API

The API is a long-running Fastify server, with a separate worker process, and
it reaches a model through Ollama. It is not a serverless function and does
not belong on Vercel. It needs a host that can run Node continuously and reach
whatever model backend is configured.

Wherever it runs, it needs to allow the application's origin:

```
API_CORS_ORIGINS=https://unioffice.pro,https://www.unioffice.pro
WEB_URL=https://unioffice.pro
API_URL=https://api.unioffice.pro
```

`API_CORS_ORIGINS` is an explicit list of origins. There is no wildcard and no
pattern matching; an origin that is not listed gets no CORS header at all.
Keep the localhost entries in the development `.env` and out of production.

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
