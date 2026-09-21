import type {
  Agent,
  AgentId,
  ApprovalRequest,
  Event,
  EventType,
  ExecutionJob,
} from "@unioffice/core";

import type { TaskSummary, WorkSummary } from "@unioffice/database";

import { publicFailureReason } from "./public-failure.js";

/**
 * What one mission is doing, read from its rows.
 *
 * A work row's status says what the pipeline last wrote, not whether anything
 * is still happening. On the live store eleven missions said "queued" and one
 * said "planning" while nothing had touched them for up to nine days - no job
 * on the queue, no worker, no plan - and every surface counted them as in
 * flight. This reads the status together with the steps, the queue and the
 * clock, and says which of those missions are moving and which have stopped
 * without anyone being told.
 *
 * Pure and deterministic: the same rows and the same clock give the same
 * reading, so the Command Center, the attention queue and the tests all agree.
 */

export type MissionPhase =
  | "planning"
  | "queued"
  | "running"
  | "waiting_approval"
  | "stalled"
  | "completed"
  | "failed"
  | "cancelled";

export type MissionBlockKind = "approval" | "agent_unavailable" | "stalled";

export type TeamState = "working" | "waiting" | "done" | "assigned" | "unavailable";

export interface MissionReading {
  phase: MissionPhase;
  /** One line for a person: what the mission is on right now. */
  stage: string;
  /** Titles of the steps being worked on, or waited on, right now. */
  currentSteps: string[];
  progress: { total: number; completed: number; running: number; failed: number };
  team: Array<{ agentId: AgentId; name: string; state: TeamState }>;
  /** The latest write to the mission, its steps or its queue job. */
  lastActivityAt: Date;
  idleMs: number;
  blocked?: { kind: MissionBlockKind; reason: string; agentId?: AgentId };
  /** Why it stopped, safe to show. */
  failure?: string;
}

/**
 * How long a mission may sit untouched before it is called stalled. The same
 * window the API already uses to decide a run was abandoned by a dead process.
 */
export const DEFAULT_STALLED_AFTER_MS = 15 * 60_000;

const TERMINAL: WorkSummary["status"][] = ["completed", "failed", "cancelled"];

export function isTerminal(status: WorkSummary["status"]): boolean {
  return TERMINAL.includes(status);
}

export function readMission(input: {
  work: WorkSummary;
  tasks: TaskSummary[];
  /** The mission's queued or running job, when it has one. */
  job?: ExecutionJob;
  approvals: ApprovalRequest[];
  agents: Map<AgentId, Agent>;
  now: Date;
  stalledAfterMs: number;
}): MissionReading {
  const { work, tasks, job, approvals, agents, now, stalledAfterMs } = input;

  const lastActivityAt = new Date(Math.max(
    work.updatedAt.getTime(),
    ...tasks.map((task) => task.updatedAt.getTime()),
    job ? job.updatedAt.getTime() : 0,
  ));
  const idleMs = Math.max(0, now.getTime() - lastActivityAt.getTime());
  const idle = formatAge(idleMs);
  const stalled = idleMs > stalledAfterMs;

  const running = tasks.filter((task) => task.status === "running");
  const waiting = tasks.filter((task) => task.status === "waiting");
  const ready = tasks.filter((task) => task.status === "ready");
  const current = running.length > 0 ? running : waiting.length > 0 ? waiting : ready;

  const base = {
    currentSteps: current.slice(0, 3).map((task) => clip(task.title, 120)),
    progress: {
      total: tasks.length,
      completed: tasks.filter((task) => task.status === "completed").length,
      running: running.length,
      failed: tasks.filter((task) => task.status === "failed").length,
    },
    team: teamOf(tasks, agents),
    lastActivityAt,
    idleMs,
  };

  switch (work.status) {
    case "completed":
      return {
        ...base,
        phase: "completed",
        stage: base.progress.total > 0 ? `Finished all ${base.progress.total} ${plural(base.progress.total, "step")}` : "Finished",
      };

    case "cancelled":
      return { ...base, phase: "cancelled", stage: "Cancelled" };

    case "failed": {
      const reason = publicFailureReason(work.executionError ?? work.planningError);

      return work.interrupted
        ? { ...base, phase: "failed", stage: "Interrupted mid-run", failure: reason ?? "The process running it stopped." }
        : { ...base, phase: "failed", stage: work.planningError && !work.executionError ? "Stopped while planning" : "Stopped", failure: reason };
    }

    case "waiting_approval": {
      const step = waiting[0]?.title;
      const approval = approvals[0];

      return {
        ...base,
        phase: "waiting_approval",
        stage: step ? `Waiting for a decision on ${quoted(step)}` : "Waiting for a decision",
        blocked: {
          kind: "approval",
          reason: approval ? clip(approval.reason, 240) : "A step will not run until a person decides.",
        },
      };
    }

    default:
      break;
  }

  const stop = (reason: string): MissionReading => ({
    ...base,
    phase: "stalled",
    stage: "Stalled",
    blocked: { kind: "stalled", reason },
  });

  let reading: MissionReading;

  if (work.status === "planning") {
    reading = stalled
      ? stop(`Planning started ${idle} ago and never finished.`)
      : { ...base, phase: "planning", stage: "Writing the plan" };
  } else if (job?.status === "running") {
    reading = { ...base, phase: "running", stage: workingOn(base.currentSteps) };
  } else if (job?.status === "queued") {
    // A retry waiting out its backoff is the queue recovering by itself; only
    // a job no worker has ever claimed means nothing is there to run it.
    reading = stalled && job.attempts === 0
      ? stop(`On the queue for ${idle}; no worker has picked it up.`)
      : {
          ...base,
          phase: "queued",
          stage: job.attempts > 0
            ? `Waiting to retry (attempt ${job.attempts + 1})`
            : work.status === "executing" ? "Waiting for a worker to resume it" : "Waiting for a worker",
        };
  } else if (work.status === "executing") {
    reading = stalled
      ? stop(`Stopped mid-run ${idle} ago with nothing on the queue to resume it.`)
      : { ...base, phase: "running", stage: workingOn(base.currentSteps) };
  } else if (tasks.length === 0) {
    reading = stalled
      ? stop(`Opened ${idle} ago and never planned.`)
      : { ...base, phase: "queued", stage: "Waiting to be planned" };
  } else {
    reading = stalled
      ? stop(`Planned ${idle} ago but never put on the queue.`)
      : { ...base, phase: "queued", stage: "Planned; not started yet" };
  }

  // A step that cannot start because its agent is out of service outranks the
  // clock: it names the actual obstacle, where "stalled" only names the symptom.
  const unavailable = unavailableAssignment(tasks, agents);

  if (unavailable) {
    reading = {
      ...reading,
      blocked: {
        kind: "agent_unavailable",
        reason: unavailable.agent
          ? `${quoted(unavailable.task.title)} is assigned to ${unavailable.agent.name}, who is ${unavailable.agent.status}.`
          : `${quoted(unavailable.task.title)} is assigned to an agent no longer on the roster.`,
        agentId: unavailable.agent?.id,
      },
    };
  }

  return reading;
}

/* --------------------------------------------------------------------------
   Events, as a person would say them
   -------------------------------------------------------------------------- */

/**
 * Events that say something happened to a mission, rather than that the
 * machinery moved. On the live store the most frequent events were
 * agent.assigned, task.created and task.ready - true, and not something a
 * person watching a company needs to read.
 */
export const MEANINGFUL_EVENT_TYPES: EventType[] = [
  "work.planning_completed",
  "work.queued",
  "work.started",
  "work.retried",
  "work.completed",
  "work.failed",
  "work.cancelled",
  "work.acknowledged",
  "task.started",
  "task.completed",
  "task.failed",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "governance.denied",
  "governance.approval_required",
  "artifact.created",
  "external.read",
  "external.write",
];

/**
 * One line describing an event, built only from the short labels the recorder
 * writes - titles, names, counts. Tool inputs and outputs, errors and every
 * other payload value stay on the server.
 */
export function describeEvent(event: Event, agents: Map<AgentId, Agent>): string | undefined {
  const payload = event.payload;
  const title = quoted(textOf(payload.title));
  const who = event.agentId ? agents.get(event.agentId)?.name : undefined;

  switch (event.type) {
    // The mission's own first moment. Every other event in the log could be
    // named and this one could not, which left any record built from the log
    // starting partway through its own story.
    case "work.created":
      return "The mission was opened";
    case "work.planning_started":
      return "Working out the steps";
    case "work.planning_completed": {
      const count = typeof payload.taskCount === "number" ? payload.taskCount : undefined;
      return count === undefined ? "Plan written" : `Plan written: ${count} ${plural(count, "step")}`;
    }
    case "work.queued":
      return payload.reason === "approval_resumed"
        ? "Back on the queue after a decision"
        : payload.reason === "retry" ? "Back on the queue for a retry" : "Put on the queue";
    case "work.started":
      return "A worker picked it up";
    case "work.retried":
      return "Retried";
    case "work.completed":
      return "Finished";
    case "work.failed":
      return "Stopped";
    case "work.cancelled":
      return "Cancelled";
    case "work.acknowledged":
      return "Marked as seen";
    case "task.started":
      return `${who ?? "An agent"} started ${title}`;
    case "task.completed":
      return `${who ?? "An agent"} finished ${title}`;
    case "task.failed": {
      const governance = payload.governance as { outcome?: unknown; policyName?: unknown } | undefined;
      return governance?.outcome === "denied"
        ? `${textOf(governance.policyName) ?? "A policy"} stopped ${title}`
        : `${title} failed`;
    }
    case "approval.requested":
      return `Asked for a decision on ${title}`;
    case "approval.approved":
      return `${capitalize(title)} was approved`;
    case "approval.rejected":
      return `${capitalize(title)} was rejected`;
    case "governance.denied":
      return `${textOf(payload.policyName) ?? "A policy"} stopped ${quoted(textOf(payload.action))}`;
    case "governance.approval_required":
      return `${textOf(payload.policyName) ?? "A policy"} requires a decision on ${quoted(textOf(payload.action))}`;
    case "artifact.created":
      return `Produced ${quoted(textOf(payload.name))}`;
    // The summary is the tool's own fixed sentence ("GitHub pull request
    // created"), never anything read from or written to the other system.
    case "external.read":
    case "external.write":
      return `${who ?? "An agent"}: ${textOf(payload.summary) ?? "used an external system"}`;
    default:
      return undefined;
  }
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

export function clip(value: string, max = 160): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/**
 * "40 minutes", "5 hours", "9 days" - the unit a person would use. Minutes are
 * kept up to two hours, because rounding ninety minutes to "2 hours" says
 * something stalled longer than it did.
 */
export function formatAge(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) return `${minutes} ${plural(minutes, "minute")}`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${plural(hours, "hour")}`;

  const days = Math.round(hours / 24);
  return `${days} ${plural(days, "day")}`;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? clip(value, 120) : undefined;
}

function quoted(value: string | undefined): string {
  return value ? `“${clip(value, 120)}”` : "a step";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function workingOn(steps: string[]): string {
  if (steps.length === 0) return "Running";
  if (steps.length === 1) return `Working on ${quoted(steps[0])}`;
  return `Working on ${steps.length} steps at once`;
}

function teamOf(tasks: TaskSummary[], agents: Map<AgentId, Agent>): MissionReading["team"] {
  const order: AgentId[] = [];
  const byAgent = new Map<AgentId, TaskSummary[]>();

  for (const task of tasks) {
    if (!task.assignedAgentId) continue;
    if (!byAgent.has(task.assignedAgentId)) order.push(task.assignedAgentId);
    byAgent.set(task.assignedAgentId, [...(byAgent.get(task.assignedAgentId) ?? []), task]);
  }

  return order.flatMap((agentId) => {
    const agent = agents.get(agentId);
    if (!agent) return [];

    const own = byAgent.get(agentId)!;
    const unfinished = own.some((task) => !isTaskTerminal(task.status));

    const state: TeamState =
      agent.status !== "active" && unfinished ? "unavailable"
        : own.some((task) => task.status === "running") ? "working"
        : own.some((task) => task.status === "waiting") ? "waiting"
        : own.every((task) => task.status === "completed") ? "done"
        : "assigned";

    return [{ agentId, name: agent.name, state }];
  });
}

function unavailableAssignment(
  tasks: TaskSummary[],
  agents: Map<AgentId, Agent>,
): { task: TaskSummary; agent?: Agent } | undefined {
  for (const task of tasks) {
    if (!task.assignedAgentId) continue;
    if (task.status !== "pending" && task.status !== "ready") continue;

    const agent = agents.get(task.assignedAgentId);

    if (!agent || agent.status !== "active") {
      return { task, agent };
    }
  }

  return undefined;
}

function isTaskTerminal(status: TaskSummary["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}
