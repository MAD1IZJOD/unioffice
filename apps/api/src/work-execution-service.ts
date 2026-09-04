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
  ApprovalCoordinator,
} from "./work-approval-service.js";

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
    private readonly approvalCoordinator?: ApprovalCoordinator,
    private readonly maxConcurrentTasks = 4,
  ) {
    if (
      !Number.isInteger(maxConcurrentTasks) ||
      maxConcurrentTasks < 1
    ) {
      throw new Error("maxConcurrentTasks must be a positive integer.");
    }
  }

  async executeWork(
    workId: WorkId,
  ): Promise<ExecuteWorkResult> {
    const work = await this.requireWork(workId);

    if (
      work.status !== "queued" &&
      work.status !== "executing"
    ) {
      if (work.status === "completed") {
        return {
          work,
          tasks: await this.taskRepository.findByWork(workId),
        };
      }

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

      tasks = await this.markReadyTasks(
        executingWork,
        tasks,
      );

      if (tasks.some((task) => task.status === "waiting")) {
        continue;
      }

      const readyTasks = tasks.filter(
        (task) => task.status === "ready",
      );

      if (readyTasks.length === 0) {
        if (tasks.some((task) => task.status === "running")) {
          return {
            work: executingWork,
            tasks,
          };
        }

        return this.failWork(
          executingWork,
          tasks,
          "No task is ready; dependencies are unresolved.",
        );
      }

      await this.executeReadyTasks(
        executingWork,
        readyTasks.slice(0, this.maxConcurrentTasks),
      );

      tasks = await this.taskRepository.findByWork(workId);
    }
  }

  private async executeReadyTasks(
    work: Work,
    tasks: Task[],
  ): Promise<void> {
    const executions = await Promise.allSettled(
      tasks.map((task) =>
        this.taskExecutionService.executeTask(task.id),
      ),
    );

    await Promise.all(executions.map(async (execution, index) => {
      if (execution.status === "rejected") {
        await this.recordExecutionFailure(
          work,
          tasks[index]!,
          execution.reason,
        );
      }
    }));
  }

  private async recordExecutionFailure(
    work: Work,
    task: Task,
    error: unknown,
  ): Promise<void> {
    const current = await this.taskRepository.findById(task.id);

    // A concurrent executor may have atomically claimed this task after this
    // runner observed it as ready. Do not overwrite that execution state.
    if (!current || current.status !== "ready") {
      return;
    }

    const failedAt = new Date();
    const failedTask = await this.taskRepository.update({
      ...current,
      status: "failed",
      completedAt: failedAt,
      updatedAt: failedAt,
      metadata: {
        ...current.metadata,
        execution: {
          status: "failed",
          error: errorMessage(error),
        },
      },
    });

    await this.eventRecorder.record({
      organizationId: work.organizationId,
      workId: work.id,
      taskId: failedTask.id,
      agentId: failedTask.assignedAgentId,
      type: "task.failed",
      payload: {
        title: failedTask.title,
        error: errorMessage(error),
      },
    });
  }

  private async markReadyTasks(
    work: Work,
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

      if (requiresApproval(task)) {
        if (!this.approvalCoordinator) {
          throw new Error(
            "Task requires approval but no approval coordinator is configured.",
          );
        }

        await this.approvalCoordinator.requestApproval(
          work,
          task,
        );
        continue;
      }

      const readyTask = await this.taskRepository.update({
        ...task,
        status: "ready",
        updatedAt: new Date(),
      });

      await this.eventRecorder.record({
        organizationId: work.organizationId,
        workId: work.id,
        taskId: readyTask.id,
        agentId: readyTask.assignedAgentId,
        type: "task.ready",
        payload: {
          title: readyTask.title,
        },
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

function requiresApproval(task: Task): boolean {
  const approval = task.metadata.approval;

  return typeof approval === "object" &&
    approval !== null &&
    (approval as Record<string, unknown>).required === true &&
    (approval as Record<string, unknown>).status !== "approved";
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}
