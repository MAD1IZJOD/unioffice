import type {
  ExecutionNode,
  ExecutionRoom,
  TaskItem,
  TaskReadiness,
} from "./api";

import type { MissionData } from "./mission";
import type { Tone } from "./tone";

/**
 * Reading the execution room.
 *
 * The backend computes what the operation *is* - the plan's shape, who is
 * holding what, what is blocking what. This file only decides how to say it:
 * which word goes on a pill, which tone a step carries, which sentence names
 * the lane. Nothing here recomputes a relationship the API already sent.
 */

/** The room, narrowed to what the shared mission reader needs. */
export function missionDataOfRoom(room: ExecutionRoom): MissionData {
  return {
    work: room.work,
    tasks: room.tasks,
    events: room.events,
    approvals: room.approvals,
    // The orchestrator is in `agents` too, so the record can name whoever
    // planned the operation as well as whoever executed it.
    agents: room.agents,
    executionJob: room.executionJob,
  };
}

export function readinessTone(readiness: TaskReadiness): Tone {
  switch (readiness) {
    case "done":
      return "live";
    case "running":
    case "ready":
      return "active";
    case "waiting":
      return "warning";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

/** Two or three words for a pill. */
export function readinessLabel(readiness: TaskReadiness): string {
  switch (readiness) {
    case "done":
      return "done";
    case "running":
      return "running";
    case "ready":
      return "ready";
    case "waiting":
      return "needs you";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    default:
      return "cancelled";
  }
}

/**
 * What a lane is, in a sentence.
 *
 * A lane with more than one step is the orchestrator having found work that
 * does not wait on itself, which is the single most useful thing this view
 * can point out - so it is stated rather than left to be inferred from two
 * cards happening to sit side by side.
 */
export function laneMeaning(size: number, depth: number): string {
  if (size > 1) {
    return `${size} steps that do not wait on each other`;
  }

  return depth === 0 ? "Starts immediately" : "Waits for the lane above";
}

/**
 * What the operation produced.
 *
 * The plan is a dependency graph, so the answer lives in a step nothing else
 * depends on - and if several finished, in the last of them. Falling back to
 * the last completed step of any kind matters for a plan whose terminal task
 * failed: something was still produced, and hiding it because the graph's
 * final node did not complete would be hiding real work.
 */
export function roomResult(room: ExecutionRoom): TaskItem | undefined {
  const finished = room.tasks.filter(
    (task) => task.status === "completed" && task.result !== undefined,
  );

  if (finished.length === 0) return undefined;

  const terminal = new Set(room.plan.terminalTaskIds);
  const preferred = finished.filter((task) => terminal.has(task.id));

  return byCompletion(preferred.length > 0 ? preferred : finished).at(-1);
}

function byCompletion(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort(
    (left, right) =>
      new Date(left.completedAt ?? left.updatedAt).getTime() -
      new Date(right.completedAt ?? right.updatedAt).getTime(),
  );
}

/** The node for a task id, for naming a dependency rather than printing a uuid. */
export function nodeTitle(
  plan: ExecutionRoom["plan"],
  taskId: string | undefined,
): string | undefined {
  if (!taskId) return undefined;

  return plan.nodes.find((node) => node.taskId === taskId)?.title;
}

/**
 * Why a step is not moving, named rather than referenced.
 *
 * Returns undefined when the step is not waiting on anything, so a caller can
 * simply not render a line rather than rendering an empty one.
 */
export function blockedExplanation(
  plan: ExecutionRoom["plan"],
  node: ExecutionNode,
): string | undefined {
  if (node.blockedBy.length === 0) return undefined;

  const names = node.blockedBy
    .map((id) => nodeTitle(plan, id))
    .filter((title): title is string => Boolean(title));

  if (names.length === 0) return undefined;

  return names.length === 1
    ? `Waiting for ${names[0]}`
    : `Waiting for ${names.length} earlier steps`;
}

/** The task rows this node came from, for the detail the graph does not carry. */
export function taskOf(
  room: ExecutionRoom,
  taskId: string,
): TaskItem | undefined {
  return room.tasks.find((task) => task.id === taskId);
}

export function agentNameOf(
  room: ExecutionRoom,
  agentId: string | undefined,
): string | undefined {
  if (!agentId) return undefined;

  return room.agents.find((agent) => agent.id === agentId)?.name;
}

export function toolNameOf(room: ExecutionRoom, toolId: string): string {
  return room.tools.find((tool) => tool.id === toolId)?.name ?? toolId;
}
