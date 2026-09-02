import {
  createEntityId,
  type AgentId,
  type TaskId,
} from "@unioffice/core";

import type {
  PlannedTask,
  Planner,
  PlanningContext,
  WorkPlan,
} from "./planner.js";

import type {
  ModelProvider,
} from "@unioffice/agents";

export class OllamaPlanner implements Planner {
  constructor(
    private readonly modelProvider: ModelProvider,
    private readonly model = "qwen3:8b",
  ) {}

  async plan(
    context: PlanningContext,
  ): Promise<WorkPlan> {
    const response =
      await this.modelProvider.generate({
        model: this.model,

        messages: [
          {
            role: "system",
            content: [
              "You are the planning engine inside UNI-OFFICE.",
              "Convert a user's objective into executable tasks.",
              "Return ONLY valid JSON.",
              "Do not use markdown.",
              "Each task must contain:",
              "ref, title, description, assignedAgentId, dependsOn.",
              "ref must be a unique short identifier such as research or analysis.",
              "dependsOn must contain task refs, never UUIDs.",
              "assignedAgentId is optional and must be one of the available agent IDs when present.",
              "Use an empty dependsOn array when a task has no prerequisites.",
              "Keep the plan practical and minimal.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              objective: context.objective,
              availableAgentIds:
                context.availableAgentIds,
              context: context.context,
            }),
          },
        ],

        temperature: 0.2,

        maxTokens: 1000,

        think: false,
      });

    const parsed = parseOllamaPlan(
      response.content,
      context.availableAgentIds,
    );

    const idsByRef = new Map(
      parsed.tasks.map((task) => [
        task.ref,
        createEntityId<"TaskId">() as TaskId,
      ]),
    );

    const tasks: PlannedTask[] =
      parsed.tasks.map((task) => ({
        id: this.taskIdForRef(idsByRef, task.ref),

        ref: task.ref,

        title: task.title,

        description:
          task.description,

        assignedAgentId:
          task.assignedAgentId
            ? (task.assignedAgentId as AgentId)
            : undefined,

        dependsOn: task.dependsOn.map(
          (ref) => this.taskIdForRef(idsByRef, ref),
        ),

        metadata: {
          plannerRef: task.ref,
        },
      }));

    return {
      workId: context.workId,

      tasks,

      metadata: {
        planner: "ollama",
        model: response.model,
      },
    };
  }

  private taskIdForRef(
    idsByRef: Map<string, TaskId>,
    ref: string,
  ): TaskId {
    const id = idsByRef.get(ref);

    if (!id) {
      throw new Error(
        `Planner task reference was not resolved: ${ref}`,
      );
    }

    return id;
  }
}

interface RawPlannedTask {
  ref: string;
  title: string;
  description: string;
  assignedAgentId?: AgentId;
  dependsOn: string[];
}

export interface ParsedOllamaPlan {
  tasks: RawPlannedTask[];
}

export function parseOllamaPlan(
  content: string,
  availableAgentIds: AgentId[],
): ParsedOllamaPlan {
  const parsed = parseJsonPlan(content);

  if (
    !Array.isArray(parsed.tasks) ||
    parsed.tasks.length === 0
  ) {
    throw new Error("Planner returned no tasks.");
  }

  const availableAgents = new Set(
    availableAgentIds,
  );

  const tasks = parsed.tasks.map((task, index) =>
    parseTask(task, index, availableAgents),
  );

  validateGraph(tasks);

  return { tasks };
}

function parseJsonPlan(content: string): {
  tasks?: unknown;
} {
  const cleaned = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as {
      tasks?: unknown;
    };
  } catch (error) {
    throw new Error(
      `Planner returned invalid JSON: ${errorMessage(error)}`,
    );
  }
}

function parseTask(
  task: unknown,
  index: number,
  availableAgents: Set<AgentId>,
): RawPlannedTask {
  if (!isRecord(task)) {
    throw new Error(
      `Planner task ${index + 1} must be an object.`,
    );
  }

  const ref = requiredText(task.ref, "ref", index);

  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(ref)) {
    throw new Error(
      `Planner task ${index + 1} has an invalid ref: ${ref}`,
    );
  }

  const assignedAgentId = parseAgentId(
    task.assignedAgentId,
    index,
    availableAgents,
  );

  return {
    ref,
    title: requiredText(task.title, "title", index),
    description: requiredText(
      task.description,
      "description",
      index,
    ),
    assignedAgentId,
    dependsOn: parseDependencies(
      task.dependsOn,
      index,
    ),
  };
}

function parseAgentId(
  value: unknown,
  index: number,
  availableAgents: Set<AgentId>,
): AgentId | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Planner task ${index + 1} has an invalid assignedAgentId.`,
    );
  }

  const id = value as AgentId;

  if (!availableAgents.has(id)) {
    throw new Error(
      `Planner task ${index + 1} assigned an unavailable agent: ${value}`,
    );
  }

  return id;
}

function parseDependencies(
  value: unknown,
  index: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Planner task ${index + 1} must include a dependsOn array.`,
    );
  }

  const dependencies = value.map((dependency) => {
    if (
      typeof dependency !== "string" ||
      !dependency.trim()
    ) {
      throw new Error(
        `Planner task ${index + 1} has an invalid dependency ref.`,
      );
    }

    return dependency.trim();
  });

  if (new Set(dependencies).size !== dependencies.length) {
    throw new Error(
      `Planner task ${index + 1} repeats a dependency ref.`,
    );
  }

  return dependencies;
}

function validateGraph(tasks: RawPlannedTask[]): void {
  const refs = new Set<string>();

  for (const task of tasks) {
    if (refs.has(task.ref)) {
      throw new Error(
        `Planner returned duplicate task ref: ${task.ref}`,
      );
    }

    refs.add(task.ref);
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency === task.ref) {
        throw new Error(
          `Planner task ${task.ref} cannot depend on itself.`,
        );
      }

      if (!refs.has(dependency)) {
        throw new Error(
          `Planner task ${task.ref} depends on unknown ref: ${dependency}`,
        );
      }
    }
  }

  const tasksByRef = new Map(
    tasks.map((task) => [task.ref, task]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(ref: string): void {
    if (visiting.has(ref)) {
      throw new Error(
        `Planner returned a circular dependency involving: ${ref}`,
      );
    }

    if (visited.has(ref)) {
      return;
    }

    visiting.add(ref);

    for (const dependency of tasksByRef.get(ref)!.dependsOn) {
      visit(dependency);
    }

    visiting.delete(ref);
    visited.add(ref);
  }

  for (const task of tasks) {
    visit(task.ref);
  }
}

function requiredText(
  value: unknown,
  field: string,
  index: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `Planner task ${index + 1} must include ${field}.`,
    );
  }

  return value.trim();
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
