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

| Agent | Role | Tools | Skills (seeded) |
| --- | --- | --- | --- |
| Tyrion | Orchestration | none | none |
| Tony | Engineering | calculator, datetime, json_transform | code-review, debugging, api-design, database-investigation, test-generation, incident-analysis |
| Harvey | Quantitative | calculator, datetime | financial-analysis, budget-review, variance-analysis, forecasting |
| Mike | Research | datetime, json_transform | web-research, competitor-analysis, source-synthesis, briefing-generation, meeting-summary |
| Jamie | Operations and people | datetime | candidate-screening, onboarding-planning, policy-drafting, employee-communication |
| Peter | Communication | datetime | executive-briefing, stakeholder-update, announcement-drafting, meeting-summary |

The seed keeps agents in line with this table on boot - unless a person has
configured an agent through the product, after which the seed leaves it alone
and skills are assigned from its profile.

## The profile

An agent's profile shows its identity and presence, current work, capabilities,
tools and what governance lets it do with each, skills and whether it can use
each, connected systems it can really reach, enforced policies that apply,
work history, artifacts and a record built from its events. Model
instructions, task outputs and tool inputs never leave the server.
