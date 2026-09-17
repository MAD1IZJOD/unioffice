# Governance

Governance decides whether a step may start and whether a tool call may run.
It is deterministic - no model is consulted - and it only ever narrows what an
agent's grants already allow.

## Where it applies

| Point | Question | Outcomes |
| --- | --- | --- |
| A step becomes eligible | May this step start? | allow, require approval, deny |
| A tool is about to run | May this call happen? | allow, deny |

A tool call cannot suspend mid-reasoning, so a tool that should need a person
is governed at the step: a policy scoped to the tool raises the step.

## Policies

Policies have a subject (tool, task, knowledge recall or capture), an effect
(allow, require approval, deny), a risk, and a scope (agents, tools,
workspaces, capabilities, knowledge types). The strongest effect among the
policies that match wins; ties resolve by risk, then id. Every decision that is
not a plain allow is written to the event log as `governance.*`.

## Floors no policy can lower

| Floor | Applies to | Decided by |
| --- | --- | --- |
| External writes | A step that needs a tool that changes another system (GitHub issue, branch, pull request) | Owner or admin |
| Skill approval | A step that follows a skill with `approval: required` | Owner or admin |

A deny policy still wins over a floor. An approved external write runs at most
once in its step, and only for the tool the approval named.

## Approvals

Every pending approval is served with a briefing (`GET /approvals`): what is
being approved, why it stopped (policy, skill, external write or the planner's
judgement), which agent is waiting, the tools involved, the risk, what approving
and rejecting each do, who may decide, and whether the caller may. The last is
computed with the same rule that refuses a decision, so the interface never
re-derives authorization.

| Approval raised by | Who may decide |
| --- | --- |
| The planner | Members with access to the workspace, admins, owners |
| A policy, an external write or a skill | Owners and admins |

Rejecting stops the step and the mission; nothing is deleted, and the mission
can be retried.

## Roles

| Role | May |
| --- | --- |
| Owner | Everything, including other owners |
| Admin | Run the organization: members, workspaces, agents, policies, skills, connections, knowledge curation |
| Member | Open and operate missions, decide planner-raised steps, propose knowledge |
| Viewer | Read what they are given |

Every check happens on the server against the membership as it is at that
moment; changes that act re-read it immediately before acting.
