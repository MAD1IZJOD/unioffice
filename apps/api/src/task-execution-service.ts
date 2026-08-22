import type {
  Task,
  TaskId,
} from "@unioffice/core";

import type {
  AgentRepository,
  TaskRepository,
} from "@unioffice/database";

import type {
  AgentRuntime,
} from "@unioffice/agents";

import {
  agentToDefinition,
} from "./agent-definition.js";

export class TaskExecutionService {
  constructor(
    private readonly taskRepository:
      TaskRepository,

    private readonly agentRepository:
      AgentRepository,

    private readonly agentRuntime:
      AgentRuntime,
  ) {}

  async executeTask(
    taskId: TaskId,
  ): Promise<Task> {
    const task =
      await this.taskRepository.findById(
        taskId,
      );

    if (!task) {
      throw new Error(
        `Task not found: ${taskId}`,
      );
    }

    if (!task.assignedAgentId) {
      throw new Error(
        `Task has no assigned agent: ${taskId}`,
      );
    }

    if (
      task.status !== "pending" &&
      task.status !== "ready"
    ) {
      throw new Error(
        `Task cannot execute from status: ${task.status}`,
      );
    }

    const agent =
      await this.agentRepository.findById(
        task.assignedAgentId,
      );

    if (!agent) {
      throw new Error(
        `Agent not found: ${task.assignedAgentId}`,
      );
    }

    if (agent.status !== "active") {
      throw new Error(
        `Agent is not active: ${agent.id}`,
      );
    }

    const now = new Date();

    const runningTask: Task = {
      ...task,

      status: "running",

      startedAt: now,

      updatedAt: now,
    };

    await this.taskRepository.update(
      runningTask,
    );

    try {
      const result =
        await this.agentRuntime.execute(
          agentToDefinition(agent),

          {
            agentId: agent.id,

            taskId: task.id,

            workId: task.workId,

            input: {
              title: task.title,

              description:
                task.description,
            },

            context: {
              ...task.metadata,
            },
          },
        );

      const completedAt =
        new Date();

      const finalTask: Task = {
        ...runningTask,

        status:
          result.status === "completed"
            ? "completed"
            : result.status === "waiting"
              ? "waiting"
              : "failed",

        completedAt:
          result.status === "completed" ||
          result.status === "failed"
            ? completedAt
            : undefined,

        updatedAt:
          completedAt,

        result:
          result.output,

        metadata: {
          ...runningTask.metadata,

          execution: {
            status:
              result.status,

            error:
              result.error,

            toolCalls:
              result.toolCalls,
          },
        },
      };

      return await this.taskRepository.update(
        finalTask,
      );
    } catch (error) {
      const failedAt =
        new Date();

      const failedTask: Task = {
        ...runningTask,

        status: "failed",

        completedAt:
          failedAt,

        updatedAt:
          failedAt,

        metadata: {
          ...runningTask.metadata,

          execution: {
            status: "failed",

            error: {
              code:
                "TASK_EXECUTION_FAILED",

              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          },
        },
      };

      return await this.taskRepository.update(
        failedTask,
      );
    }
  }
}