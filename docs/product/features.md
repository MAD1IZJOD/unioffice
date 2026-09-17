# Features

Skills answer **"what can the workforce do?"** Features answer **"what can the
product do, here, for this person?"**

The feature registry (`apps/api/src/features/feature-registry.ts`) describes
each surface as data: where it lives, which area of the product it belongs to,
what a person needs to see it, what it depends on, and its status on this
server. `GET /features` returns the registry for the signed-in person, and the
web app builds its navigation, breadcrumb and command palette from it.

| Area | Features |
| --- | --- |
| Command | Command Center |
| Work | Missions, Approvals, Artifacts |
| Workforce | Agents, Skills, Tools |
| Knowledge | Company Brain, Activity |
| Company | Organization, Members, Governance, Connections |

## Status

| Status | Meaning | Example |
| --- | --- | --- |
| `available` | Works fully | Missions |
| `limited` | Works, with something missing worth saying | Company Brain without an embedding model (keyword recall only) |
| `needs_configuration` | Does nothing until the server is configured | Connections without an OAuth client and encryption key |

A feature that directly depends on one needing configuration is shown as
limited, with the reason. Statuses come from the server's real configuration,
not from anything the browser guesses.

## What it is not

The registry is deliberately small. It is not a plugin system - it cannot add
routes or code - and hiding a feature is not a security boundary. Every route
still authenticates and authorizes on its own; the registry only keeps the
product from being a collection of hard-coded screens that each have their own
idea of what exists.

Until `/features` answers, the web app shows the product's own surfaces
(`FALLBACK_FEATURES` in `apps/web/src/lib/navigation.ts`); a feature the web
app has no icon for still appears.
