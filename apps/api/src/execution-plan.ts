import type {
  AgentId,
  Task,
  TaskId,
  TaskStatus,
} from "@unioffice/core";

/**
 * The plan, read as a shape rather than as a list.
 *
 * A task row carries `dependsOn`, and that single field is what makes an
 * operation legible: which steps could start at once, which one is waiting on
 * which, and which task the rest of them feed into. Every surface that wanted
 * to say "Harvey is waiting for Mike" was working that out for itself from
 * the raw array, which is how three surfaces ended up with three answers.
 *
 * Nothing here is inferred or embellished. Depth comes from the edges the
 * planner wrote, readiness comes from the status the executor set, and a task
 * with no dependencies is at depth zero because that is what the data says.
 */

/** What a step is actually doing, once its dependencies are taken into account. */
export type TaskReadiness =
  | "blocked"
  | "ready"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "cancelled";

export interface ExecutionNode {
  taskId: TaskId;
  title: string;
  description: string;
  status: TaskStatus;
  readiness: TaskReadiness;
  assignedAgentId?: AgentId;

  /** How many dependency hops from the start of the plan. */
  depth: number;

  dependsOn: TaskId[];

  /** The steps that cannot start until this one finishes. */
  blocks: TaskId[];

  /** The dependencies that have not finished yet, which is what is holding it. */
  blockedBy: TaskId[];

  toolCallCount: number;
  requiredTools: string[];
  requiredCapabilities: string[];

  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;

  /** True when a person has to decide before this step goes any further. */
  awaitingApproval: boolean;
}

/** Steps at the same depth, which is to say steps that can run at the same time. */
export interface ExecutionLane {
  depth: number;
  taskIds: TaskId[];
}

export interface ExecutionPlan {
  nodes: ExecutionNode[];
  lanes: ExecutionLane[];

  /** The steps nothing else depends on: where the plan comes out. */
  terminalTaskIds: TaskId[];

  totalCount: number;
  completedCount: number;
  failedCount: number;

  /** Completed as a percentage of the plan. */
  progress: number;

  /** How many steps are genuinely executing at this instant. */
  runningCount: number;

  /**
   * The widest the plan ever gets. One means a chain; more means the
   * orchestrator found work that could be done at the same time.
   */
  widestLane: number;

  /**
   * True when the planner wrote dependencies that point in a circle. The
   * layering falls back to declaration order so the plan still renders, but
   * this is worth saying out loud rather than papering over: a cycle means
   * some of those steps can never become ready on their own.
   */
  hasCycle: boolean;
}

export function buildExecutionPlan(
  tasks: Task[],
  options: { awaitingApprovalTaskIds?: Iterable<TaskId> } = {},
): ExecutionPlan {
  const byId = new Map<TaskId, Task>(tasks.map((task) => [task.id, task]));
  const awaiting = new Set(options.awaitingApprovalTaskIds ?? []);

  // A planner can name a dependency that is not in the plan. Keeping those
  // edges would make a step permanently blocked by something that does not
  // exist, so they are dropped here and the step is judged on the
  // dependencies it genuinely has.
  const edges = new Map<TaskId, TaskId[]>(
    tasks.map((task) => [
      task.id,
      task.dependsOn.filter((id) => byId.has(id) && id !== task.id),
    ]),
  );

  const blocks = new Map<TaskId, TaskId[]>(tasks.map((task) => [task.id, []]));

  for (const task of tasks) {
    for (const dependency of edges.get(task.id) ?? []) {
      blocks.get(dependency)?.push(task.id);
    }
  }

  const { depths, hasCycle } = layer(tasks, edges);

  const nodes: ExecutionNode[] = tasks.map((task) => {
    const dependsOn = edges.get(task.id) ?? [];
    const blockedBy = dependsOn.filter(
      (id) => byId.get(id)?.status !== "completed",
    );

    return {
      taskId: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      readiness: readinessOf(task, blockedBy.length === 0),
      assignedAgentId: task.assignedAgentId,
      depth: depths.get(task.id) ?? 0,
      dependsOn,
      blocks: blocks.get(task.id) ?? [],
      blockedBy,
      toolCallCount: toolCallsOf(task),
      requiredTools: routingList(task, "requiredTools"),
      requiredCapabilities: routingList(task, "requiredCapabilities"),
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      durationMs:
        task.startedAt && task.completedAt
          ? task.completedAt.getTime() - task.startedAt.getTime()
          : undefined,
      awaitingApproval: awaiting.has(task.id),
    };
  });

  const laneDepths = [...new Set(nodes.map((node) => node.depth))].sort(
    (left, right) => left - right,
  );

  const lanes: ExecutionLane[] = laneDepths.map((depth) => ({
    depth,
    taskIds: nodes
      .filter((node) => node.depth === depth)
      .map((node) => node.taskId),
  }));

  const completedCount = nodes.filter(
    (node) => node.status === "completed",
  ).length;

  return {
    nodes,
    lanes,
    terminalTaskIds: nodes
      .filter((node) => node.blocks.length === 0)
      .map((node) => node.taskId),
    totalCount: nodes.length,
    completedCount,
    failedCount: nodes.filter((node) => node.status === "failed").length,
    progress:
      nodes.length === 0 ? 0 : Math.round((completedCount / nodes.length) * 100),
    runningCount: nodes.filter((node) => node.status === "running").length,
    widestLane: lanes.reduce(
      (widest, lane) => Math.max(widest, lane.taskIds.length),
      0,
    ),
    hasCycle,
  };
}

/**
 * Longest-path layering: a step sits one below its deepest dependency, so a
 * lane genuinely means "nothing here is waiting on anything else here".
 *
 * Kahn's algorithm, because it reports a cycle rather than looping forever on
 * one - and the plan is written by a model, so a cycle is a thing that
 * happens rather than a thing that cannot.
 */
function layer(
  tasks: Task[],
  edges: Map<TaskId, TaskId[]>,
): { depths: Map<TaskId, number>; hasCycle: boolean } {
  const depths = new Map<TaskId, number>();
  const remaining = new Map<TaskId, number>(
    tasks.map((task) => [task.id, (edges.get(task.id) ?? []).length]),
  );

  const dependents = new Map<TaskId, TaskId[]>(
    tasks.map((task) => [task.id, []]),
  );

  for (const task of tasks) {
    for (const dependency of edges.get(task.id) ?? []) {
      dependents.get(dependency)?.push(task.id);
    }
  }

  const queue: TaskId[] = [];

  for (const task of tasks) {
    if ((remaining.get(task.id) ?? 0) === 0) {
      depths.set(task.id, 0);
      queue.push(task.id);
    }
  }

  let settled = 0;

  while (queue.length > 0) {
    const current = queue.shift() as TaskId;
    settled += 1;

    for (const dependent of dependents.get(current) ?? []) {
      depths.set(
        dependent,
        Math.max(depths.get(dependent) ?? 0, (depths.get(current) ?? 0) + 1),
      );

      const left = (remaining.get(dependent) ?? 0) - 1;
      remaining.set(dependent, left);

      if (left === 0) queue.push(dependent);
    }
  }

  if (settled === tasks.length) {
    return { depths, hasCycle: false };
  }

  // Whatever is left is in or behind a cycle. It still has to render, so it
  // is laid out in declaration order after everything that did settle.
  const floor = Math.max(0, ...depths.values()) + 1;
  let offset = 0;

  for (const task of tasks) {
    if (depths.has(task.id)) continue;
    depths.set(task.id, floor + offset);
    offset += 1;
  }

  return { depths, hasCycle: true };
}

function readinessOf(task: Task, unblocked: boolean): TaskReadiness {
  switch (task.status) {
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "ready":
      return "ready";
    default:
      // A pending task with everything it needs behind it is ready in every
      // sense that matters to a reader, whether or not the executor has got
      // round to saying so.
      return unblocked ? "ready" : "blocked";
  }
}

function toolCallsOf(task: Task): number {
  const execution = task.metadata.execution as
    | { toolCalls?: unknown[] }
    | undefined;

  return Array.isArray(execution?.toolCalls) ? execution.toolCalls.length : 0;
}

function routingList(task: Task, field: string): string[] {
  const routing = task.metadata.routing as Record<string, unknown> | undefined;
  const value = routing?.[field];

  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
