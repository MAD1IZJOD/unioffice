# 001: One pnpm and turbo monorepo

## Decision

API, worker and web app live in one repository with shared packages, built and
tested with pnpm workspaces and turbo.

## Why

- The API and worker share one runtime wiring, so governance and execution
  cannot drift between the process that accepts work and the one that runs it.
- Entities, validation and security-critical logic (the tool executor, the
  policy engine, skill validation, credential sealing) are written once and
  tested once.
- A change that crosses layers - a new entity, its migration, repository,
  service, route and page - lands and is verified together.

## Consequences

- Packages are consumed from source (`main: ./src/index.ts`); there is no
  separate build step for internal packages.
- TypeScript is pinned to 6.0 across the workspace; TypeScript 7 waits for
  typescript-eslint support.
- Node 24 or later is required (`engines` in the root `package.json`).
