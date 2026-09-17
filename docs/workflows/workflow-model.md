# Workflows

Today a mission's plan is the workflow: the planner writes steps with
dependencies, the execution plan arranges them into lanes, and the worker runs
each step when its dependencies have finished and governance allows it.

## What exists

- **Execution plan** (`apps/api/src/execution-plan.ts`): steps, dependencies,
  lanes, what each step is blocked by, its required tools, the skill it
  follows, tool call counts and timing. Unknown dependencies are dropped and a
  cycle is reported rather than hanging.
- **Durable queue**: `execution_jobs` holds at most one queued or running job
  per mission; workers claim jobs with a compare-and-swap and a lease, so a run
  survives restarts and is never executed twice.
- **Mission templates**: briefed starting points (for example a financial
  review) that open an ordinary mission.
- **Workflow tables** (`workflows`, `workflow_nodes`, `packages/workflows`): a
  stored model for reusable, explicitly defined workflows.

## What does not exist yet

There is no workflow editor and nothing executes a stored workflow directly;
those tables are empty. The feature registry does not list workflows as a
feature, so the product does not offer something it cannot do.

## Recurring work and skills

A skill already captures "how a kind of work is done" and applies to every
mission that uses it. Stored workflows are the planned home for "these steps,
in this order, every time"; when they arrive they will run through the same
planner-free path of delegation, governance, skills and the durable queue
rather than a separate engine.
