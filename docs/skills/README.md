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

## Which skill a step follows

The server decides, not the model.

1. **Planning.** The planner is offered only active skills, resolved for the
   mission's workspace, that at least one available agent holds. It may
   suggest one skill per step. A suggestion changes nothing on its own: an
   unknown slug is dropped, and a known one adds no requirements.
2. **Resolution.** `resolveSkill` (`packages/skills/src/resolver.ts`) ranks the
   skills that apply against what the step says it needs, with fixed weights:

   | Signal | Weight |
   | --- | --- |
   | Named by a person in the request | 1000 |
   | Suggested by the planner | 200 |
   | Each required capability the step also asks for | 40 |
   | Each required tool the step also asks for | 40 |
   | Each word of the skill's name or slug in the step | 25 |
   | The step is in the skill's category | 15 |
   | Words from the skill's description in the step, capped | 5 each, 20 max |

   A skill is only a candidate when an available agent holds it *and* already
   has every tool and capability it needs. Unprompted, a skill needs 40 points
   before it is chosen, so one stray word is never enough. Ties are broken by
   the narrowest scope, then the more specific skill, then the slug, so the
   answer never depends on the order rows arrive in. Two equal candidates with
   nothing between them resolve to none, and ask for one to be named.

   Every selection carries its reasons, in a person's words: *"the step needs
   calculator, which it uses"*, *"Ledger holds it with everything it needs"*.
   They are recorded on the step and shown in the execution room.
3. **Requirements.** The chosen skill's tools and capabilities become the
   step's, so routing and governance see them whether or not the planner
   listed them.
4. **Delegation.** The step goes only to an eligible agent holding the skill,
   and tool grants remain a hard boundary. If none can take it, the step is
   routed without the skill and the record says why.
5. **Recording.** The server writes the skill onto the step's routing: `ref`,
   slug, name, **version**, scope, approval, memory and reasons. When no skill
   was chosen, `skillNote` says why in a sentence.

## Version pinning

A step runs the version of a skill it was planned around, not whatever the
skill says today.

- Every published version is kept in `skill_versions` (migration
  `20260918000000_skill_versions`), keyed by `(organization_id, skill_ref,
  version)` and never updated. `skill_ref` is the skill's uuid, or
  `system:<slug>` for one that ships with the product; a system skill is
  recorded the first time an organization pins it.
- Execution loads the pinned version. Publishing v2 changes what later
  missions do; a mission already part way through keeps v1.
- The skill must still be live: one archived or replaced since is not run, and
  the step says so rather than quietly going ahead.
- A pinned version that is not on record is never swapped for a different one.

## Running a step

The procedure reaches the model as a delimited `<skill>` section, labelled as
configuration that cannot change rules, give tools or approve anything; the
procedure cannot close its own section. `memory: none` skips knowledge recall.
The step records the skill and version it ran with.

If the agent has lost a tool or capability the skill needs since planning, the
step does not follow the procedure and says which one: *"Ledger could not
follow Expense signoff because Calculator access is no longer available."*

## Approval

A skill with `approval: required` raises every step that follows it to need a
person. A policy cannot lower that; a deny still wins; an owner or admin
decides.

What is approved is a **proposal**, not a step in the abstract. Before anyone
is asked, the server writes down what would happen - the agent, the skill and
its pinned version, the tools, the external writes, the mission - into
`action_proposals` (migration `20260918010000_action_proposals`), with a
sha-256 fingerprint of those fields. The approval points at that proposal by
id and carries its hash, and the person reads the sentence it produced:

> Ledger would carry out "Expense Signoff for Q3" following Expense signoff
> version 1, using Calculator.

Before the step runs, the action is described again from the step as it then
is. If the fingerprint differs - a different agent, a different skill version,
another tool - the decision does not cover what would happen now. The step
does not run: the approval is marked superseded, `approval.superseded` is
recorded, and a fresh approval is raised against the action as it now stands.
Proposals are never edited; a changed action is a new proposal.

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

- Resolution ranks only the skills an organization already has, against the
  agents it already has. It cannot invent a skill, a scope, an owner, a tool
  grant or a capability, and a slug named in a request that does not resolve
  here is refused rather than searched for elsewhere.
- An approval is bound to one concrete action by fingerprint, so a step cannot
  change into something else between being approved and being run.

Tests: `packages/skills/src/skills.test.ts`,
`packages/skills/src/resolver.test.ts`,
`apps/api/src/skills/skill-service.test.ts`,
`apps/api/src/skills/skill-security.test.ts`,
`apps/api/src/approvals/proposal-binding.test.ts`,
`apps/api/src/access/skill-routes.test.ts`,
`apps/api/src/skill-execution.test.ts`,
`apps/api/src/agent-directory-skills.test.ts`, and the runtime and planner
tests for injection.
