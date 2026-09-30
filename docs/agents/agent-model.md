# Agents

An agent is a member of the workforce: a name, a role, and exactly what it is
allowed to use. Agents do not gain anything from what they read.

| Field | Meaning |
| --- | --- |
| `type` | `orchestrator` (plans and routes), `specialist`, `manager` |
| `status` | `active`, `paused` (given no new steps), `disabled` |
| `capabilities` | The planner's routing vocabulary |
| `toolIds` | Tools the agent may call - the hard boundary the executor enforces |
| `skills` | Skill slugs the agent may be given steps for |
| `workspaceId` | Absent: works anywhere. Set: only that workspace's missions |

## Agents, skills and tools

```
agent  --holds-->  skills  --need-->  tools + capabilities
agent  --holds-->  tools (grants)
```

- Assigning a skill grants nothing; it is refused unless the agent already
  holds every tool and capability the skill needs.
- A step that follows a skill only goes to an agent assigned it, and still only
  to one holding its tools.
- If a tool is later taken away, the assignment stays visible on the profile as
  "Cannot use", and no step needing that tool is routed there.

## The development workforce

Seventy-one agents: sixty-nine blueprints the seed provisions, and Dana and
Rhea, whom people made. The blueprints are the one place the seeded agents
are defined - name, role, room, capabilities, tools and skills:

| Source | Who |
| --- | --- |
| `workforce` in `apps/api/src/development-workforce.ts` | Tyrion, Tony, Harvey, Mike, Jamie, Peter |
| `proposedWorkforce` in the same file | the twelve after them, from Wanda to Katrina |
| `apps/api/src/workforce-expansion.ts` | the fifty-one of the expansion, by department |

| Room | Agents |
| --- | --- |
| Company hall (no workspace) | 6 - Tyrion, Jamie, Peter, Victor, Stella, Adrian |
| Engineering | 18 |
| Product | 7 |
| Research | 7 |
| Revenue & Growth | 13 |
| Operations | 8 |
| Finance | 5 |
| Customer Success | 6 |
| Compliance & Risk | 1 - Victoria |

The API provisions `completeDevelopmentWorkforce` on boot only when
`SEED_DEVELOPMENT_WORKFORCE=true`. It is idempotent: a room the company
already has is found by its slug and reused, a missing one is made once, an
agent is created once under its fixed id and brought back in line with its
blueprint on later boots - unless a person has configured it through the
product, after which the seed leaves it alone. Every agent beyond the first
twenty is held by `workforce-expansion.test.ts` to real tools, skills it can
use and a capability nobody else has. All agents run on the one model the
API is configured with; there is no per-agent model.

## The profile

An agent's profile shows its identity and presence, current work, capabilities,
tools and what governance lets it do with each, skills and whether it can use
each, connected systems it can really reach, enforced policies that apply,
work history, artifacts and a record built from its events. Model
instructions, task outputs and tool inputs never leave the server.
