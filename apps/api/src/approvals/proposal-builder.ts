import {
  hashProposedAction,
  type Agent,
  type ProposedAction,
  type Task,
  type Work,
} from "@unioffice/core";

/**
 * What a step would do, described from the step as it stands.
 *
 * This is what a person is actually asked to allow. It is built from settled
 * facts - who the step is assigned to, which skill and version it is pinned
 * to, which tools it is authorized to use, which of those write to systems
 * outside the company - and never from anything a model has produced or has
 * yet to produce. Two descriptions of the same step agree; a step that has
 * changed in any of those respects describes differently, and that is what
 * stops an approval from carrying over to a different action.
 */
export function describeAction(input: {
  work: Work;
  task: Task;
  agent?: Pick<Agent, "id" | "name">;
  /** Turns a tool id into the name a person knows it by. */
  toolName?: (toolId: string) => string;
}): { summary: string; action: ProposedAction } {
  const { work, task, agent } = input;
  const name = (toolId: string) => input.toolName?.(toolId) ?? toolId;

  const routing = task.metadata.routing as
    | { requiredTools?: unknown; skill?: Record<string, unknown> }
    | undefined;

  const tools = stringsOf(routing?.requiredTools);
  const externalWrites = externalWritesOf(task);
  const skill = skillOf(routing?.skill);

  const action: ProposedAction = {
    step: { title: task.title, description: task.description },
    agent: agent ? { id: agent.id, name: agent.name } : undefined,
    skill,
    tools,
    externalWrites,
    objective: work.objective,
  };

  return { summary: summarise(action, name), action };
}

/** The fingerprint an approval is bound to. */
export function hashOfTask(input: Parameters<typeof describeAction>[0]): string {
  return hashProposedAction(describeAction(input).action);
}

/**
 * The one sentence someone reads before deciding. Who, what procedure, what
 * it will touch - in that order, because that is the order the question is
 * asked in: is this the right agent, doing the right thing, to the right
 * system.
 */
function summarise(action: ProposedAction, name: (toolId: string) => string): string {
  const who = action.agent?.name ?? "An unassigned agent";
  const how = action.skill
    ? ` following ${action.skill.name} version ${action.skill.version}`
    : "";
  const withWhat = action.tools.length > 0
    ? `, using ${action.tools.map(name).join(", ")}`
    : "";
  const outside = action.externalWrites.length > 0
    ? ` This changes something outside the company through ${action.externalWrites.map(name).join(", ")}.`
    : "";

  return `${who} would carry out "${action.step.title}"${how}${withWhat}.${outside}`.slice(0, 500);
}

function skillOf(skill: Record<string, unknown> | undefined): ProposedAction["skill"] {
  if (
    !skill ||
    typeof skill.slug !== "string" ||
    typeof skill.name !== "string" ||
    typeof skill.version !== "number"
  ) {
    return undefined;
  }

  return {
    ref: typeof skill.ref === "string" ? skill.ref : skill.slug,
    slug: skill.slug,
    name: skill.name,
    version: skill.version,
  };
}

/** The tools that write outside, as governance recorded them on the step. */
function externalWritesOf(task: Task): string[] {
  const approval = task.metadata.approval as { externalWrites?: unknown } | undefined;
  const governance = task.metadata.governance as { externalWrites?: unknown } | undefined;

  return [...new Set([
    ...stringsOf(approval?.externalWrites),
    ...stringsOf(governance?.externalWrites),
  ])];
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
