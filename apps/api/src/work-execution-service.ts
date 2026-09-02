import type {
  Task,
  Work,
  WorkId,
} from "@unioffice/core";

import type {
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  EventRecorder,
} from "./event-recorder.js";

import type {
  TaskExecutionService,
} from "./task-execution-service.js";

export interface ExecuteWorkResult {
  work: Work;
  tasks: Task[];
}

export class WorkExecutionService {
  constructor(
    private readonly workRepository: WorkRepository,
    private readonly taskRepository: TaskRepository,
    private readonly taskExecutionService: TaskExecutionService,
    private readonly eventRecorder: EventRecorder,
  ) {}

  async executeWork(
    workId: WorkId,
  ): Promise<ExecuteWorkResult> {
    const work = await this.requireWork(workId);

    if (
      work.status !== "queued" &&
      work.status !== "executing"
    ) {
      throw new Error(
        `Work cannot execute from status: ${work.status}`,
      );
    }

    let executingWork = work;

    if (work.status !== "executing") {
      const startedAt = new Date();
      executingWork = await this.workRepository.update({
        ...work,
        status: "executing",
        startedAt: work.startedAt ?? startedAt,
        updatedAt: startedAt,
      });

      await this.eventRecorder.record({
        organizationId: executingWork.organizationId,
        workId: executingWork.id,
        type: "work.started",
        payload: {
          objective: executingWork.objective,
        },
      });
    }

    let tasks = await this.taskRepository.findByWork(workId);

    if (tasks.length === 0) {
      return this.failWork(
        executingWork,
        tasks,
        "Cannot execute work without planned tasks.",
      );
    }

    while (true) {
      const failedTask = tasks.find(
        (task) => task.status === "failed",
      );

      if (failedTask) {
        return this.failWork(
          executingWork,
          tasks,
          `Task failed: ${failedTask.title}`,
        );
      }

      const waitingTask = tasks.find(
        (task) => task.status === "waiting",
      );

      if (waitingTask) {
        const waitingWork =
          await this.workRepository.update({
            ...executingWork,
            status: "waiting_approval",
            updatedAt: new Date(),
            metadata: {
              ...executingWork.metadata,
              waitingTaskId: waitingTask.id,
            },
          });

        await this.eventRecorder.record({
          organizationId: waitingWork.organizationId,
          workId: waitingWork.id,
          taskId: waitingTask.id,
          type: "approval.requested",
          payload: {
            title: waitingTask.title,
          },
        });

        return {
          work: waitingWork,
          tasks,
        };
      }

      if (
        tasks.every(
          (task) => task.status === "completed",
        )
      ) {
        const completedAt = new Date();
        const completedWork =
          await this.workRepository.update({
            ...executingWork,
            status: "completed",
            updatedAt: completedAt,
            completedAt,
          });

        await this.eventRecorder.record({
          organizationId: completedWork.organizationId,
          workId: completedWork.id,
          type: "work.completed",
          payload: {
            taskCount: tasks.length,
          },
        });

        return {
          work: completedWork,
          tasks,
        };
      }

      tasks = await this.markReadyTasks(tasks);

      const nextTask = tasks.find(
        (task) => task.status === "ready",
      );

      if (!nextTask) {
        return this.failWork(
          executingWork,
          tasks,
          "No task is ready; dependencies are unresolved.",
        );
      }

      try {
        await this.taskExecutionService.executeTask(
          nextTask.id,
        );
      } catch (error) {
        const failedAt = new Date();
        const failedTask =
          await this.taskRepository.update({
            ...nextTask,
            status: "failed",
            completedAt: failedAt,
            updatedAt: failedAt,
            metadata: {
              ...nextTask.metadata,
              execution: {
                status: "failed",
                error: errorMessage(error),
              },
            },
          });

        await this.eventRecorder.record({
          organizationId: executingWork.organizationId,
          workId: executingWork.id,
          taskId: failedTask.id,
          agentId: failedTask.assignedAgentId,
          type: "task.failed",
          payload: {
            title: failedTask.title,
            error: errorMessage(error),
          },
        });
      }

      tasks = await this.taskRepository.findByWork(workId);
    }
  }

  private async markReadyTasks(
    tasks: Task[],
  ): Promise<Task[]> {
    const tasksById = new Map(
      tasks.map((task) => [task.id, task]),
    );

    for (const task of tasks) {
      if (task.status !== "pending") {
        continue;
      }

      const dependenciesCompleted = task.dependsOn.every(
        (dependencyId) =>
          tasksById.get(dependencyId)?.status === "completed",
      );

      if (!dependenciesCompleted) {
        continue;
      }

      await this.taskRepository.update({
        ...task,
        status: "ready",
        updatedAt: new Date(),
      });
    }

    return this.taskRepository.findByWork(
      tasks[0]!.workId,
    );
  }

  private async failWork(
    work: Work,
    tasks: Task[],
    reason: string,
  ): Promise<ExecuteWorkResult> {
    const completedAt = new Date();
    const failedWork =
      await this.workRepository.update({
        ...work,
        status: "failed",
        updatedAt: completedAt,
        completedAt,
        metadata: {
          ...work.metadata,
          executionError: reason,
        },
      });

    await this.eventRecorder.record({
      organizationId: failedWork.organizationId,
      workId: failedWork.id,
      type: "work.failed",
      payload: {
        reason,
      },
    });

    return {
      work: failedWork,
      tasks,
    };
  }

  private async requireWork(
    workId: WorkId,
  ): Promise<Work> {
    const work = await this.workRepository.findById(
      workId,
    );

    if (!work) {
      throw new Error(`Work not found: ${workId}`);
    }

    return work;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
