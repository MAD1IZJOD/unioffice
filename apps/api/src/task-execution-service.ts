import type {
  Task,
  TaskId,
} from "@unioffice/core";

import type {
  AgentRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  ExecutionEngine,
} from "@unioffice/orchestrator";

import {
  agentToDefinition,
} from "./agent-definition.js";

import type {
  EventRecorder,
} from "./event-recorder.js";

export class TaskExecutionService {
  constructor(
    private readonly taskRepository:
      TaskRepository,

    private readonly workRepository:
      WorkRepository,

    private readonly agentRepository:
      AgentRepository,

    private readonly executionEngine:
      ExecutionEngine,

    private readonly eventRecorder:
      EventRecorder,
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

    const work = await this.workRepository.findById(
      task.workId,
    );

    if (!work) {
      throw new Error(`Work not found: ${task.workId}`);
    }

    if (task.status !== "ready") {
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

    const startedAt = new Date();
    const runningTask: Task = {
      ...task,
      status: "running",
      startedAt,
      updatedAt: startedAt,
    };

    await this.taskRepository.update(runningTask);

    await this.eventRecorder.record({
      organizationId: agent.organizationId,
      workId: task.workId,
      taskId: task.id,
      agentId: agent.id,
      type: "task.started",
      payload: {
        title: task.title,
      },
    });

    try {
      const result =
        await this.executionEngine.execute({
          workId: task.workId,
          taskId: task.id,
          agentId: agent.id,
          agent: agentToDefinition(agent),
          work: {
            objective: work.objective,
            organizationId: work.organizationId,
            workspaceId: work.workspaceId,
            priority: work.priority,
            metadata: work.metadata,
          },
          task: {
            title: task.title,
            description: task.description,
            dependencies: await this.dependencyResults(task),
          },
          context: {
            taskMetadata: task.metadata,
          },
        });

      const completedAt = new Date();
      const status =
        result.status === "completed"
          ? "completed"
          : result.status === "waiting"
            ? "waiting"
            : "failed";

      const finalTask: Task = {
        ...runningTask,
        status,
        completedAt:
          status === "completed" ||
          status === "failed"
            ? completedAt
            : undefined,
        updatedAt: completedAt,
        result: result.output,
        metadata: {
          ...runningTask.metadata,
          execution: {
            status: result.status,
            error: result.error,
            metadata: result.metadata,
          },
        },
      };

      const persistedTask =
        await this.taskRepository.update(finalTask);

      if (persistedTask.status === "completed") {
        await this.eventRecorder.record({
          organizationId: agent.organizationId,
          workId: persistedTask.workId,
          taskId: persistedTask.id,
          agentId: agent.id,
          type: "task.completed",
          payload: {
            title: persistedTask.title,
          },
        });
      } else if (persistedTask.status === "failed") {
        await this.eventRecorder.record({
          organizationId: agent.organizationId,
          workId: persistedTask.workId,
          taskId: persistedTask.id,
          agentId: agent.id,
          type: "task.failed",
          payload: {
            title: persistedTask.title,
            error: result.error,
          },
        });
      }

      return persistedTask;
    } catch (error) {
      const failedAt = new Date();
      const failedTask: Task = {
        ...runningTask,
        status: "failed",
        completedAt: failedAt,
        updatedAt: failedAt,
        metadata: {
          ...runningTask.metadata,
          execution: {
            status: "failed",
            error: {
              code: "TASK_EXECUTION_FAILED",
              message: errorMessage(error),
            },
          },
        },
      };

      const persistedTask =
        await this.taskRepository.update(failedTask);

      await this.eventRecorder.record({
        organizationId: agent.organizationId,
        workId: persistedTask.workId,
        taskId: persistedTask.id,
        agentId: agent.id,
        type: "task.failed",
        payload: {
          title: persistedTask.title,
          error: errorMessage(error),
        },
      });

      return persistedTask;
    }
  }

  private async dependencyResults(
    task: Task,
  ): Promise<Array<{
    id: TaskId;
    title: string;
    result?: unknown;
  }>> {
    const dependencies = await Promise.all(
      task.dependsOn.map((dependencyId) =>
        this.taskRepository.findById(dependencyId),
      ),
    );

    return dependencies.flatMap((dependency) =>
      dependency?.status === "completed"
        ? [{
            id: dependency.id,
            title: dependency.title,
            result: dependency.result,
          }]
        : [],
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
