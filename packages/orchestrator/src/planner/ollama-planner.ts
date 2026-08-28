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
              "title, description, assignedAgentId, dependsOn.",
              "assignedAgentId must be one of the available agent IDs.",
              "dependsOn must contain task IDs of earlier tasks.",
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

    const parsed =
      this.parseResponse(response.content);

    const tasks: PlannedTask[] =
      parsed.tasks.map((task) => ({
        id:
          createEntityId<"TaskId">() as TaskId,

        title: task.title,

        description:
          task.description,

        assignedAgentId:
          task.assignedAgentId
            ? (task.assignedAgentId as AgentId)
            : undefined,

        dependsOn: [],

        metadata: {},
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

  private parseResponse(
    content: string,
  ): {
    tasks: Array<{
      title: string;
      description: string;
      assignedAgentId?: string;
    }>;
  } {
    const cleaned =
      content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

    const parsed =
      JSON.parse(cleaned) as {
        tasks?: Array<{
          title?: unknown;
          description?: unknown;
          assignedAgentId?: unknown;
        }>;
      };

    if (
      !Array.isArray(parsed.tasks) ||
      parsed.tasks.length === 0
    ) {
      throw new Error(
        "Planner returned no tasks",
      );
    }

    return {
      tasks: parsed.tasks.map((task) => {
        if (
          typeof task.title !== "string" ||
          typeof task.description !== "string"
        ) {
          throw new Error(
            "Planner returned an invalid task",
          );
        }

        return {
          title: task.title,
          description: task.description,
          assignedAgentId:
            typeof task.assignedAgentId === "string"
              ? task.assignedAgentId
              : undefined,
        };
      }),
    };
  }
}