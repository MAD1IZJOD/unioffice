# Changelog

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
