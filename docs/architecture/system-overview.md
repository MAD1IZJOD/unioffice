# UNIOFFICE 2.0 - system overview

UNIOFFICE is an AI-native operating system for companies. A person states an
objective; the company plans the work, routes each step to an agent that holds
what the step needs, executes it through governed tools, keeps what it learns,
and stops for a person wherever a person is required.

```
company
  -> work (missions)
    -> agents (the workforce)
      -> skills (how a kind of work is done)
        -> tools (what can be executed)
          -> knowledge (what the company has learned)
            -> governance (what is allowed, what needs a person)
              -> artifacts (what was produced)
                -> human decisions (approvals)
```

## Processes

| Process | Package | Role |
| --- | --- | --- |
| API | `apps/api` (Fastify) | Authentication, authorization, every read and write, planning on request, the live event stream |
| Worker | `apps/worker` | Claims durable jobs and executes missions: delegation, governance, tools, memory |
| Web | `apps/web` (React 19, Vite 8) | The interface. Reads only the API; holds only the public Supabase key, for sign-in |

The API and the worker share one runtime (`apps/api/src/runtime.ts`), so they
cannot disagree about how a step is governed or executed.

## Packages

| Package | What it owns |
| --- | --- |
| `core` | Entities and ids: work, task, agent, skill, policy, knowledge, connection, events |
| `database` | Repositories, each with a Supabase and an in-memory implementation |
| `orchestrator` | The planner (Ollama), the delegator, the execution engine |
| `agents` | The agent runtime: prompt assembly, the tool loop, trust boundaries |
| `tools` | Tool contract, registry, executor (grant check, write approval, governance guard) |
| `governance` | The deterministic policy engine |
| `memory` | Knowledge extraction and scoring |
| `skills` | The system skill catalogue, validation, precedence, agent fit, procedure rendering |
| `connect` | External systems: sealed credentials, OAuth, provider clients, connector tools |
| `workflows` | Workflow data model (stored; no editor yet) |

## A mission, end to end

1. **Open.** `POST /work` records the objective and optional briefing.
2. **Plan.** The planner is given the objective, the capabilities and tools the
   available agents hold, the skills they hold (resolved for the mission's
   workspace) and recalled company knowledge. It returns steps; each may name
   one skill, whose tool and capability requirements are folded into the step.
3. **Delegate.** Each step goes to an active agent in scope that holds every
   required tool - and, when the step names a skill, that holds the skill.
   The skill applied is recorded on the step by the server.
4. **Queue.** `POST /work/:id/execute` puts a durable job on the queue.
5. **Govern.** As each step becomes eligible, governance evaluates it:
   enforced policies, plus floors no policy can lower - external writes and
   skills set to require approval always wait for an owner or admin.
6. **Execute.** The worker runs the step: the skill's procedure (resolved
   again, so edits apply), recalled knowledge unless the skill opts out, and a
   tool loop where every call passes the grant check, write approval,
   governance and, for external systems, connection resolution.
7. **Record.** Results become task output and artifacts, events describe
   what happened, and knowledge capture proposes what was learned.

## Security posture

- Every request is authenticated with Supabase Auth and authorized against the
  caller's membership, read fresh; organization and workspace boundaries read
  as not found.
- Every table has row-level security enabled and forced, no policies, and no
  privileges for `anon` or `authenticated`. Only the API and worker, with the
  service role, reach data. `supabase/checks/posture.sql` verifies this.
- Anything a model reads that a person or another system wrote - knowledge,
  tool results, external content, skill procedures - is delimited and labelled
  as data. What an agent may do comes only from the server: the agent row, the
  step's recorded approval and governance.

See also: [features](../product/features.md), [skills](../skills/README.md),
[governance](../governance/README.md), [memory](../memory/README.md).
