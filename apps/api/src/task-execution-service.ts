import type {
  Agent,
  Artifact,
  ArtifactId,
  Task,
  TaskId,
} from "@unioffice/core";

import {
  createEntityId,
} from "@unioffice/core";

import type {
  AgentRepository,
  ArtifactRepository,
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
  CompanyBrainService,
} from "./company-brain-service.js";

import type {
  EventRecorder,
} from "./event-recorder.js";

export class TaskExecutionService {
  constructor(
    private readonly taskRepository:
      TaskRepository,

    private readonly artifactRepository:
      ArtifactRepository,

    private readonly workRepository:
      WorkRepository,

    private readonly agentRepository:
      AgentRepository,

    private readonly executionEngine:
      ExecutionEngine,

    private readonly eventRecorder:
      EventRecorder,

    private readonly companyBrainService?:
      CompanyBrainService,
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
      task.status === "completed" ||
      task.status === "running"
    ) {
      return task;
    }

    if (task.status !== "ready") {
      throw new Error(
        `Task cannot execute from status: ${task.status}`,
      );
    }

    const work = await this.workRepository.findById(
      task.workId,
    );

    if (!work) {
      throw new Error(`Work not found: ${task.workId}`);
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
    const runningTask =
      await this.taskRepository.claimReadyForExecution(
        task.id,
        startedAt,
      );

    if (!runningTask) {
      const current = await this.taskRepository.findById(task.id);

      if (!current) {
        throw new Error(`Task not found: ${task.id}`);
      }

      return current;
    }

    await this.eventRecorder.record({
      organizationId: agent.organizationId,
      workId: runningTask.workId,
      taskId: runningTask.id,
      agentId: agent.id,
      type: "task.started",
      payload: {
        title: runningTask.title,
      },
    });

    try {
      const relevantMemory = await this.retrieveRelevantMemory(
        agent.organizationId,
        agent.id,
        runningTask,
      );

      const result =
        await this.executionEngine.execute({
          workId: runningTask.workId,
          taskId: runningTask.id,
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
            title: runningTask.title,
            description: runningTask.description,
            dependencies: await this.dependencyResults(runningTask),
            requiredTools: requiredToolsFromTask(runningTask),
          },
          context: {
            taskMetadata: runningTask.metadata,
            relevantMemory,
          },
        });

      for (const toolCall of result.toolCalls) {
        await this.eventRecorder.record({
          organizationId: agent.organizationId,
          workId: runningTask.workId,
          taskId: runningTask.id,
          agentId: agent.id,
          type: toolCall.status === "completed" ? "tool.completed" : "tool.failed",
          payload: {
            toolId: toolCall.toolId,
            input: toolCall.input,
            output: toolCall.output,
            error: toolCall.error,
          },
        });
      }

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
            toolCalls: result.toolCalls,
          },
        },
      };

      const persistedTask =
        await this.taskRepository.update(finalTask);

      let resolvedTask = persistedTask;

      if (persistedTask.status === "completed") {
        resolvedTask = await this.persistResultArtifact(
          persistedTask,
          agent,
          result.metadata,
        );

        await this.eventRecorder.record({
          organizationId: agent.organizationId,
          workId: resolvedTask.workId,
          taskId: resolvedTask.id,
          agentId: agent.id,
          type: "task.completed",
          payload: {
            title: resolvedTask.title,
          },
        });

        await this.recordOutcomeMemory(agent, resolvedTask, "completed", stringifyResult(result.output));
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

        await this.recordOutcomeMemory(
          agent,
          persistedTask,
          "failed",
          result.error?.message ?? "Execution failed without a specific error.",
        );
      }

      return resolvedTask;
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

      await this.recordOutcomeMemory(agent, persistedTask, "failed", errorMessage(error));

      return persistedTask;
    }
  }

  private async retrieveRelevantMemory(
    organizationId: Agent["organizationId"],
    agentId: Agent["id"],
    task: Task,
  ): Promise<unknown[]> {
    if (!this.companyBrainService) {
      return [];
    }

    try {
      const memories = await this.companyBrainService.retrieveRelevant({
        organizationId,
        agentId,
        query: `${task.title} ${task.description}`,
        limit: 5,
      });

      return memories.map((memory) => ({
        type: memory.type,
        content: memory.content,
      }));
    } catch {
      // Memory retrieval is an enhancement, not a dependency. A failure here
      // must not block task execution.
      return [];
    }
  }

  private async recordOutcomeMemory(
    agent: Agent,
    task: Task,
    status: "completed" | "failed",
    summary: string,
  ): Promise<void> {
    if (!this.companyBrainService) {
      return;
    }

    try {
      await this.companyBrainService.recordTaskOutcome({
        organizationId: agent.organizationId,
        agentId: agent.id,
        workId: task.workId,
        taskId: task.id,
        title: task.title,
        status,
        summary,
      });
    } catch {
      // Best-effort: the task's own persisted status remains the source of
      // truth even if the company brain write fails.
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

  private async persistResultArtifact(
    task: Task,
    agent: Agent,
    executionMetadata: Record<string, unknown>,
  ): Promise<Task> {
    if (task.result === undefined) {
      return task;
    }

    const now = new Date();
    const artifact: Artifact = {
      id: createEntityId<"ArtifactId">() as ArtifactId,
      organizationId: agent.organizationId,
      workId: task.workId,
      taskId: task.id,
      createdByAgentId: agent.id,
      name: `${task.title} result`,
      type: isStructured(task.result) ? "structured_data" : "analysis",
      description: `Execution result produced by ${agent.name}.`,
      mimeType: isStructured(task.result)
        ? "application/json"
        : "text/plain",
      version: 1,
      createdAt: now,
      updatedAt: now,
      metadata: {
        content: task.result,
        execution: executionMetadata,
      },
    };

    try {
      const createdArtifact =
        await this.artifactRepository.create(artifact);

      await this.eventRecorder.record({
        organizationId: agent.organizationId,
        workId: task.workId,
        taskId: task.id,
        agentId: agent.id,
        type: "artifact.created",
        payload: {
          artifactId: createdArtifact.id,
          name: createdArtifact.name,
          type: createdArtifact.type,
        },
      });

      return task;
    } catch (error) {
      // Task completion remains durable even if a secondary artifact projection
      // cannot be written. Preserve that degradation on the task for operators.
      try {
        return await this.taskRepository.update({
          ...task,
          metadata: {
            ...task.metadata,
            artifact: {
              status: "failed",
              error: errorMessage(error),
            },
          },
        });
      } catch {
        // The completed task result remains the source of truth if this
        // diagnostic update also fails.
      }

      return task;
    }
  }
}

function isStructured(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value) ?? "No result was produced.";
  } catch {
    return "Result could not be serialized.";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function requiredToolsFromTask(task: Task): string[] {
  const routing = task.metadata.routing;

  if (typeof routing !== "object" || routing === null) {
    return [];
  }

  const requiredTools = (routing as Record<string, unknown>).requiredTools;

  return Array.isArray(requiredTools)
    ? requiredTools.filter((tool): tool is string => typeof tool === "string")
    : [];
}
