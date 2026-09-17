import type {
  Agent,
  Artifact,
  Skill,
  ArtifactId,
  OrganizationId,
  SkillRef,
  Task,
  TaskId,
  Work,
} from "@unioffice/core";

import {
  createEntityId,
  skillRefOf,
} from "@unioffice/core";

import type {
  AgentRepository,
  ArtifactRepository,
  TaskRepository,
  WorkRepository,
} from "@unioffice/database";

import type {
  AgentToolCall,
  RecalledKnowledgeItem,
} from "@unioffice/agents";

import type {
  ExecutionEngine,
} from "@unioffice/orchestrator";

import {
  agentToDefinition,
} from "./agent-definition.js";

import type {
  EventRecorder,
} from "./event-recorder.js";

import type {
  KnowledgeCaptureService,
} from "./knowledge-capture-service.js";

import type {
  KnowledgeRecallService,
} from "./knowledge-recall-service.js";

/**
 * What a step needs from company knowledge: something to recall before it
 * runs, and somewhere to put what it learned afterwards. Narrowed to the two
 * calls actually made, so a test can supply either without the rest.
 */
export interface TaskKnowledge {
  recall: Pick<KnowledgeRecallService, "recallForStep">;
  capture: Pick<KnowledgeCaptureService, "captureFromTask">;
}

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

    private readonly knowledge?:
      TaskKnowledge,

    /** Loads the skill a step pinned when it was planned. */
    private readonly skills?: {
      effective(organizationId: Work["organizationId"], workspaceId?: Work["workspaceId"]): Promise<Map<string, Skill>>;

      /** The exact version a step pinned, as it was written then. */
      pinned?(organizationId: OrganizationId, ref: SkillRef, version: number): Promise<Skill | null>;
    },
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

    // An agent can only ever work inside its own organization. Delegation
    // already guarantees this; checking it here as well means knowledge is
    // never recalled on behalf of an agent from somewhere else.
    if (agent.organizationId !== work.organizationId) {
      throw new Error(
        `Agent does not belong to the work's organization: ${agent.id}`,
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
      // The step runs the version of the skill it pinned when it was planned,
      // not whatever the skill says today. A skill that has since been
      // archived is not run at all, and the step says so rather than quietly
      // going ahead without the procedure it was planned around.
      const { skill, note: skillNote } = await this.skillFor(work, runningTask);

      const knowledge = skill?.memory === "none"
        ? []
        : await this.recallKnowledge(
            work,
            runningTask,
            agent,
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
            approvedTools: approvedExternalWrites(runningTask),
            skill: skill
              ? {
                  slug: skill.slug,
                  name: skill.name,
                  version: skill.version,
                  instructions: skill.instructions,
                  inputs: skill.inputs,
                  outputs: skill.outputs,
                }
              : undefined,
          },
          context: {
            taskMetadata: runningTask.metadata,
          },
          knowledge,
        });

      for (const toolCall of result.toolCalls) {
        await this.eventRecorder.record({
          organizationId: agent.organizationId,
          workId: runningTask.workId,
          taskId: runningTask.id,
          agentId: agent.id,
          ...toolCallEvent(toolCall),
        });
      }

      const externalSources = result.toolCalls
        .filter((toolCall) => toolCall.external && toolCall.status === "completed")
        .map((toolCall) => ({
          toolId: toolCall.toolId,
          provider: toolCall.external!.provider,
          access: toolCall.external!.access,
          action: toolCall.audit?.action,
          resource: toolCall.audit?.resource,
        }));

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
            // Where outside information came from, by reference only.
            ...(externalSources.length > 0 ? { externalSources } : {}),
            ...(skill
              ? { skill: { ref: skillRefOf(skill), slug: skill.slug, version: skill.version, scope: skill.scope } }
              : {}),
            ...(skillNote ? { skillNote } : {}),
          },
          // Which knowledge this step was handed, by reference. The full
          // record of why lives on the recall rows; this is what lets a step
          // say "used K1 and K3" without another read.
          knowledge: knowledge.length > 0
            ? {
                recalled: knowledge.map((item) => ({
                  ref: item.ref,
                  id: item.id,
                  title: item.title,
                  status: item.status,
                })),
              }
            : undefined,
        },
      };

      const persistedTask =
        await this.taskRepository.update(finalTask);

      let resolvedTask = persistedTask;

      if (persistedTask.status === "completed") {
        const persisted = await this.persistResultArtifact(
          persistedTask,
          agent,
          result.metadata,
        );

        resolvedTask = persisted.task;

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

        // A step that read from another system is not mined for company
        // knowledge automatically. Its answer can carry a document's or an
        // issue's content - untrusted, and not the company's to memorise
        // without someone choosing to. It stays in the step and its artifact,
        // with its sources, where a person can propose it deliberately.
        if (externalSources.length === 0) {
          await this.captureKnowledge(
            work,
            resolvedTask,
            agent,
            result.output,
            persisted.artifactId,
          );
        }
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

      return persistedTask;
    }
  }

  /**
   * The skill this step pinned, exactly as it was written then.
   *
   * The version is settled at planning and never moves: publishing a new
   * version of a skill changes what later missions do, not what this one is
   * part way through. The skill still has to be live - one that has been
   * archived or replaced since is not run, and the step carries the reason.
   */
  private async skillFor(work: Work, task: Task): Promise<{ skill?: Skill; note?: string }> {
    const routing = task.metadata.routing as
      | { skill?: { ref?: unknown; slug?: unknown; name?: unknown; version?: unknown } }
      | undefined;
    const pin = routing?.skill;
    const slug = typeof pin?.slug === "string" ? pin.slug : undefined;

    if (!this.skills || !slug) {
      return {};
    }

    const name = typeof pin?.name === "string" ? pin.name : slug;
    const live = (await this.skills.effective(work.organizationId, work.workspaceId)).get(slug);

    if (!live) {
      return { note: `${name} is no longer available here, so this step ran without it.` };
    }

    const version = typeof pin?.version === "number" ? pin.version : undefined;

    if (version === undefined || version === live.version) {
      return { skill: live };
    }

    const ref = typeof pin?.ref === "string" ? pin.ref : skillRefOf(live);
    const pinned = this.skills.pinned
      ? await this.skills.pinned(work.organizationId, ref, version)
      : null;

    if (pinned) {
      return { skill: pinned };
    }

    return {
      note: `${name} version ${version}, which this step was planned around, is no longer on record, so this step ran without it.`,
    };
  }

  private async recallKnowledge(
    work: Work,
    task: Task,
    agent: Agent,
  ): Promise<RecalledKnowledgeItem[]> {
    if (!this.knowledge) {
      return [];
    }

    try {
      const recalled = await this.knowledge.recall.recallForStep(
        work,
        task,
        agent,
      );

      return recalled.items;
    } catch {
      // Knowledge is an enhancement, not a dependency. A step that cannot
      // recall anything runs from its objective and dependencies alone.
      return [];
    }
  }

  /**
   * What the step taught the company, if anything.
   *
   * Only a completed step is considered - a failure's error message is not
   * company knowledge - and the capture path decides whether anything in the
   * output is durable at all. Failures of that path never reach the task.
   */
  private async captureKnowledge(
    work: Work,
    task: Task,
    agent: Agent,
    output: unknown,
    artifactId: ArtifactId | undefined,
  ): Promise<void> {
    if (!this.knowledge) {
      return;
    }

    try {
      await this.knowledge.capture.captureFromTask({
        work,
        task,
        agent,
        output,
        artifactId,
      });
    } catch {
      // Best-effort: the completed task and its artifact are the source of
      // truth whether or not anything was learned from them.
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
  ): Promise<{ task: Task; artifactId?: ArtifactId }> {
    if (task.result === undefined) {
      return { task };
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

      return { task, artifactId: createdArtifact.id };
    } catch (error) {
      // Task completion remains durable even if a secondary artifact projection
      // cannot be written. Preserve that degradation on the task for operators.
      try {
        return {
          task: await this.taskRepository.update({
            ...task,
            metadata: {
              ...task.metadata,
              artifact: {
                status: "failed",
                error: errorMessage(error),
              },
            },
          }),
        };
      } catch {
        // The completed task result remains the source of truth if this
        // diagnostic update also fails.
      }

      return { task };
    }
  }
}

function isStructured(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

/**
 * The external writes a person approved this step for - exactly what the
 * approval named, and only once it is granted. Never read from anything a
 * model produced.
 */
function approvedExternalWrites(task: Task): string[] {
  const approval = task.metadata.approval;

  if (typeof approval !== "object" || approval === null) {
    return [];
  }

  const { status, externalWrites } = approval as { status?: unknown; externalWrites?: unknown };

  return status === "approved" && Array.isArray(externalWrites)
    ? externalWrites.filter((toolId): toolId is string => typeof toolId === "string")
    : [];
}

/**
 * The audit line for one tool call.
 *
 * A local tool's input and output are kept as before. An external call keeps
 * only what the tool itself said happened - "GitHub pull request created",
 * with the repository and number - so neither a document read from a drive
 * nor text written to GitHub is copied into the event log.
 */
function toolCallEvent(toolCall: AgentToolCall): {
  type: "tool.completed" | "tool.failed" | "external.read" | "external.write";
  payload: Record<string, unknown>;
} {
  if (!toolCall.external) {
    return {
      type: toolCall.status === "completed" ? "tool.completed" : "tool.failed",
      payload: {
        toolId: toolCall.toolId,
        input: toolCall.input,
        output: toolCall.output,
        error: toolCall.error,
      },
    };
  }

  const reference = {
    toolId: toolCall.toolId,
    provider: toolCall.external.provider,
    access: toolCall.external.access,
  };

  if (toolCall.status !== "completed") {
    return { type: "tool.failed", payload: { ...reference, error: toolCall.error } };
  }

  return {
    type: toolCall.external.access === "write" ? "external.write" : "external.read",
    payload: {
      ...reference,
      action: toolCall.audit?.action,
      summary: toolCall.audit?.summary,
      resource: toolCall.audit?.resource,
    },
  };
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
