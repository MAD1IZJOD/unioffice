# Skills

A **tool** is an executable primitive: `calculator`, `github_issue`,
`drive_read_file`. It does one thing and returns a result.

A **skill** is how a kind of work is done well: an operating procedure, what it
works from and produces, which tools and capabilities it relies on, and whether
a person must approve each step. `financial-analysis`, `code-review` and
`candidate-screening` are skills.

A skill never grants anything. It cannot give an agent a tool, a capability, a
permission or a connection, and it cannot remove an approval.

## The model

| Field | Meaning |
| --- | --- |
| `slug` | Stable identity. Agents are assigned it and plans name it. Cannot change. |
| `name`, `description`, `category` | For people. Categories: engineering, research, finance, people, communication, operations. |
| `scope` | `system` (ships with UNIOFFICE), `organization`, or `workspace`. |
| `version` | Increases on every change. Changes need the version the editor saw. |
| `status` | `draft` (not used), `active`, `archived` (kept for history, frees the slug). |
| `instructions` | The procedure, up to 6,000 characters. Configuration, not rules. |
| `inputs`, `outputs` | Named fields (`text`, `number`, `list`, `table`), up to 12 each. |
| `requiredTools` | Tools an agent must already hold. Each must exist in the registry. |
| `requiredCapabilities` | Capabilities an agent must already have. |
| `approval` | `none`, or `required`: every step that follows the skill waits for an owner or admin. |
| `memory` | `recall` (steps get relevant company knowledge) or `none`. |

System skills live in `packages/skills/src/catalog.ts` as data. Organization
and workspace skills are rows in `skills` (migration `20260917010000_skills`),
with row-level security forced and no browser privileges. Agents hold skill
slugs in `agents.skills`.

## Precedence

For the same slug, the narrowest active skill wins:

```
workspace skill  >  organization skill  >  system skill
```

Drafts never override anything; archived skills never take part; another
workspace's skill never applies. An organization replaces a system skill by
creating its own skill with the same slug ("Adapt for the company").

## Lifecycle

1. **Write.** An owner or admin creates a skill as a draft or active
   (`POST /skills`). Workspace skills need reach into that workspace.
2. **Change.** `POST /skills/:id` with `expectedVersion`; a stale version is
   refused rather than overwriting someone else's change.
3. **Activate, archive, restore.** `POST /skills/:id/status`.
4. **Assign.** `POST /agents/:id` with `skills`. Refused unless the agent
   already holds every required tool and capability, checked against the agent
   as it will be after the change.

Every change is recorded as `skill.created`, `skill.updated`, `skill.archived`
or `skill.restored`, with names and versions - never the instructions.

## Execution

1. **Planning.** The planner is offered only active skills, resolved for the
   mission's workspace, that at least one available agent holds. A step may
   name one skill. An unknown slug is dropped, not trusted. A known skill's
   tools and capabilities are added to the step's requirements.
2. **Delegation.** A step that names a skill goes only to an eligible agent
   holding it, and tool grants remain a hard boundary. If no eligible agent
   holds it, the step is routed without the skill and the record says
   `skillDropped`.
3. **Recording.** The server writes the applied skill onto the step's routing:
   slug, name, version, scope, approval and memory.
4. **Governance.** A skill with `approval: required` raises the step to
   require approval. A policy cannot lower it; a deny still wins. The approval
   is decided by an owner or admin.
5. **Running.** The skill is resolved again when the step runs, so an edit or
   archive is honoured. Its procedure reaches the model as a delimited
   `<skill>` section, labelled as configuration that cannot change rules, give
   tools or approve anything; the procedure cannot close its own section.
   `memory: none` skips knowledge recall. The step records the version it ran
   with.

## Security

Skills are treated as potentially hostile configuration:

- Validation refuses unknown fields, so a request cannot set scope, version,
  status or ownership. Invisible and direction-changing characters are
  stripped. Tools must exist.
- A skill's requirements are requirements, never grants. The tool executor
  still checks the agent row, external writes still need the step's recorded
  approval, and governance still decides every call.
- Another organization's skill reads as not found; skills of a workspace the
  caller cannot reach are invisible.

Tests: `packages/skills/src/skills.test.ts`,
`apps/api/src/skills/skill-service.test.ts`,
`apps/api/src/access/skill-routes.test.ts`,
`apps/api/src/skill-execution.test.ts`,
`apps/api/src/agent-directory-skills.test.ts`, and the runtime and planner
tests for injection.
