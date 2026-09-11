import {
  formatRelativeTime,
  type ActivityEvent,
  type AgentSummary,
  type ApprovalItem,
  type ExecutionJobSummary,
  type TaskItem,
  type WorkItem,
} from "./api";

import type { Tone } from "./tone";

/**
 * A mission is a work item read as an operation rather than as a row.
 *
 * Everything in this file is derived from data the API actually returns - the
 * work row, its tasks, its events, its approvals, and the durable queue job
 * behind it. Nothing here invents a state, a step or a participant to make the
 * story read better. If the company did not do it, it is not narrated.
 */

/**
 * Where a mission stands, in the vocabulary the durable queue and the work
 * rows genuinely support.
 *
 * `claimed` and `running` are distinct on purpose: a worker having taken the
 * job is not the same as an agent having started a task, and conflating them
 * makes the queue look instant when it is not.
 */
export type MissionPhase =
  | "unplanned"
  | "planning"
  | "queued"
  | "claimed"
  | "running"
  | "waiting"
  | "recovering"
  | "delivered"
  | "stopped";

export interface MissionState {
  phase: MissionPhase;
  /** Two or three words for a pill. */
  label: string;
  /** What the company is doing about this objective, in one sentence. */
  line: string;
  /** Why that is the case, or what happens next. */
  note?: string;
  tone: Tone;
  /** True while the mission can still change on its own. */
  live: boolean;
}

export interface MissionData {
  work: WorkItem;
  tasks: TaskItem[];
  events: ActivityEvent[];
  approvals: ApprovalItem[];
  agents: AgentSummary[];
  executionJob?: ExecutionJobSummary | null;
}

/** The briefing the requester attached, if they attached one. */
export function briefingOf(work: WorkItem): string | undefined {
  const briefing = work.metadata.briefing;

  return typeof briefing === "string" && briefing.trim()
    ? briefing.trim()
    : undefined;
}

/**
 * A queued job that has already burned an attempt is the queue picking a
 * mission back up, which is the only recovery the system genuinely performs.
 */
export function isRecovering(job: ExecutionJobSummary | null | undefined): boolean {
  return Boolean(
    job && job.status === "queued" && (job.attempts > 0 || job.lastError),
  );
}

export function readMission(data: MissionData): MissionState {
  const { work, tasks, approvals, executionJob } = data;

  const pending = approvals.filter((approval) => approval.status === "pending");
  const running = tasks.filter((task) => task.status === "running");
  const done = tasks.filter((task) => task.status === "completed").length;

  if (pending.length > 0) {
    return {
      phase: "waiting",
      label: "Waiting for you",
      line:
        pending.length === 1
          ? "The company stopped at a step it will not take without you."
          : `The company stopped at ${pending.length} steps it will not take without you.`,
      note: "Deciding puts the mission straight back on the queue.",
      tone: "warning",
      live: true,
    };
  }

  if (isRecovering(executionJob)) {
    return {
      phase: "recovering",
      label: "Recovering",
      line: "UNI-OFFICE put this mission back on the queue.",
      note: executionJob?.lastError
        ? `Attempt ${executionJob.attempts} did not finish: ${executionJob.lastError}`
        : `Resuming on attempt ${(executionJob?.attempts ?? 0) + 1}.`,
      tone: "active",
      live: true,
    };
  }

  if (work.status === "completed") {
    return {
      phase: "delivered",
      label: "Delivered",
      line: "The company finished this mission.",
      note:
        tasks.length > 0
          ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} carried it.`
          : undefined,
      tone: "live",
      live: false,
    };
  }

  if (work.status === "failed") {
    const interrupted = Boolean(work.metadata.interrupted);

    return {
      phase: "stopped",
      label: interrupted ? "Interrupted" : "Stopped",
      line: interrupted
        ? "Execution stopped part-way through."
        : "This mission did not finish.",
      note: interrupted
        ? "Finished tasks were kept. Resuming picks up from the first one that did not."
        : messageOf(work) ??
          "Finished tasks were kept. A retry resumes from the first one that did not.",
      tone: interrupted ? "warning" : "error",
      live: false,
    };
  }

  if (running.length > 0) {
    return {
      phase: "running",
      label: "Running",
      line:
        running.length === 1
          ? "An agent is working on this now."
          : `${running.length} agents are working on this now.`,
      note: `${done} of ${tasks.length} tasks complete.`,
      tone: "active",
      live: true,
    };
  }

  if (executionJob?.status === "running") {
    return {
      phase: "claimed",
      label: "Claimed",
      line: `A worker has taken this mission${
        executionJob.claimedBy ? ` (${executionJob.claimedBy})` : ""
      }.`,
      note: "The first task starts as soon as the worker reaches it.",
      tone: "active",
      live: true,
    };
  }

  if (executionJob?.status === "queued") {
    return {
      phase: "queued",
      label: "Queued",
      line: "This mission is on the durable queue.",
      note: "The next free worker picks it up. Nothing is lost if the API restarts.",
      tone: "active",
      live: true,
    };
  }

  if (work.status === "planning") {
    return {
      phase: "planning",
      label: "Planning",
      line: "The plan is being written.",
      note: "The objective is being decomposed into tasks the workforce can be given.",
      tone: "active",
      live: true,
    };
  }

  if (tasks.length === 0) {
    return {
      phase: "unplanned",
      label: "No plan yet",
      line: "This mission has been recorded and nothing else.",
      note: "Building the plan decomposes it and routes each task to a specialist.",
      tone: "idle",
      live: false,
    };
  }

  return {
    phase: "queued",
    label: "Ready",
    line: "The plan is written and waiting to be run.",
    note: `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} ready to go to the queue.`,
    tone: "idle",
    live: false,
  };
}

/** The failure the backend recorded on the work row, if it recorded one. */
export function messageOf(work: WorkItem): string | undefined {
  const execution = work.metadata.executionError;
  const planning = work.metadata.planningError;

  if (typeof execution === "string") return execution;
  if (typeof planning === "string") return planning;

  return undefined;
}

/**
 * The orchestrator, which is who plans and delegates. Read off the roster
 * rather than hard-coded, so renaming the workforce does not put a stale name
 * in the narration.
 */
export function orchestratorOf(agents: AgentSummary[]): string | undefined {
  return agents.find((agent) => agent.type === "orchestrator")?.name;
}

/* --------------------------------------------------------------------------
   The narration

   The event log written as sentences. Every line names the real agent, the
   real task and the real tool from the event's own payload; an event whose
   payload does not carry a name gets a line that does not claim one.
   -------------------------------------------------------------------------- */

export type MissionAct =
  | "objective"
  | "strategy"
  | "workforce"
  | "execution"
  | "decisions"
  | "output";

export interface MissionMoment {
  id: string;
  at: string;
  when: string;
  act: MissionAct;
  tone: "tone-live" | "tone-active" | "tone-warning" | "tone-error" | "tone-idle";
  /** The sentence. */
  line: string;
  /** The specifics, when the payload carries any worth reading. */
  note?: string;
  /** The agent the moment belongs to, when the event names one. */
  actor?: string;
}

export interface NarrationSources {
  tasks: TaskItem[];
  agents: AgentSummary[];
  /**
   * Only enough of a tool to name it. The narration says "Harvey reached for
   * Calculator" and never renders a schema, so asking callers for the full
   * descriptor would force a second request for fields nothing here reads.
   */
  tools?: Array<{ id: string; name: string }>;
}

/**
 * Turns the mission's events into lines a person can read in order.
 *
 * The log is the company's own record, so this reads names out of it rather
 * than printing event types: "Tyrion gave the cost analysis to Harvey" is what
 * happened, "agent.assigned" is how it was stored.
 */
export function narrateMission(
  events: ActivityEvent[],
  sources: NarrationSources,
): MissionMoment[] {
  const taskTitle = (id: string | undefined): string | undefined =>
    sources.tasks.find((task) => task.id === id)?.title;

  const agentName = (id: string | undefined): string | undefined =>
    sources.agents.find((agent) => agent.id === id)?.name;

  const orchestrator = orchestratorOf(sources.agents);

  const toolName = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    const tool = sources.tools?.find((candidate) => candidate.id === id);
    return tool?.name ?? id.replace(/_/g, " ");
  };

  return [...events]
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
    )
    .map((event) => {
      const told = tell(event, {
        taskTitle,
        agentName,
        toolName,
        orchestrator,
      });

      return {
        id: event.id,
        at: event.timestamp,
        when: formatRelativeTime(event.timestamp),
        ...told,
      };
    });
}

interface Vocabulary {
  taskTitle: (id: string | undefined) => string | undefined;
  agentName: (id: string | undefined) => string | undefined;
  toolName: (id: string | undefined) => string | undefined;
  orchestrator?: string;
}

function tell(
  event: ActivityEvent,
  words: Vocabulary,
): Omit<MissionMoment, "id" | "at" | "when"> {
  const payload = event.payload ?? {};
  const text = (key: string): string | undefined => {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const number = (key: string): number | undefined => {
    const value = payload[key];
    return typeof value === "number" ? value : undefined;
  };

  const task = words.taskTitle(event.taskId) ?? text("title");
  const actor = words.agentName(event.agentId);
  const planner = words.orchestrator;
  const named = (name: string | undefined, fallback: string) => name ?? fallback;

  switch (event.type) {
    case "work.created":
      return {
        act: "objective",
        tone: "tone-idle",
        line: "You gave the company this objective.",
        note: text("objective"),
      };

    case "work.planning_started":
      return {
        act: "strategy",
        tone: "tone-active",
        actor: planner,
        line: `${named(planner, "The orchestrator")} started working out how to do it.`,
      };

    case "work.planning_completed": {
      const count = number("taskCount") ?? 0;

      return {
        act: "strategy",
        tone: "tone-active",
        actor: planner,
        line: `${named(planner, "The orchestrator")} settled on a plan of ${count} ${
          count === 1 ? "task" : "tasks"
        }.`,
      };
    }

    case "task.created":
      return {
        act: "strategy",
        tone: "tone-idle",
        actor: planner,
        line: `${named(planner, "The orchestrator")} wrote the task “${
          task ?? "untitled"
        }”.`,
        note: requirementNote(payload, words),
      };

    case "agent.assigned":
      return {
        act: "workforce",
        tone: "tone-active",
        actor,
        line: actor
          ? `${named(planner, "The orchestrator")} gave “${task ?? "a task"}” to ${actor}.`
          : `“${task ?? "A task"}” was routed to a specialist.`,
        note: delegationNote(payload),
      };

    case "work.queued":
      return {
        act: "execution",
        tone: "tone-active",
        line:
          payload.reason === "approval_resumed"
            ? "Your decision put the mission back on the queue."
            : payload.reason === "retry"
              ? "The mission went back on the queue to be retried."
              : payload.reason === "recovered"
                ? "UNI-OFFICE recovered the mission and queued it again."
                : "The mission went onto the durable queue.",
        note: "A worker takes it from here, so the run survives a restart.",
      };

    case "work.started":
      return {
        act: "execution",
        tone: "tone-active",
        line: "A worker picked the mission up and started executing.",
      };

    case "task.ready":
      // A reclaimed task is not a step becoming unblocked - it is the system
      // taking work back from a worker that stopped, which is the one moment
      // where recovery is visible from the outside. Saying "became
      // unblocked" here would hide the most reassuring thing the product
      // does.
      if (payload.reclaimed === true) {
        return {
          act: "execution",
          tone: "tone-warning",
          actor,
          line: `The worker running “${task ?? "a task"}” stopped, so UNI-OFFICE took the step back.`,
          note: "Nothing finished was lost. Another worker picks it up from here.",
        };
      }

      return {
        act: "execution",
        tone: "tone-idle",
        actor,
        line: `“${task ?? "A task"}” became unblocked.`,
      };

    case "task.started":
      return {
        act: "execution",
        tone: "tone-active",
        actor,
        line: actor
          ? `${actor} started “${task ?? "a task"}”.`
          : `“${task ?? "A task"}” started.`,
      };

    case "tool.called":
      return {
        act: "execution",
        tone: "tone-active",
        actor,
        line: actor
          ? `${actor} reached for ${words.toolName(text("toolId")) ?? "a tool"}.`
          : `${words.toolName(text("toolId")) ?? "A tool"} was called.`,
      };

    case "tool.completed":
      return {
        act: "execution",
        tone: "tone-live",
        actor,
        line: `${words.toolName(text("toolId")) ?? "The tool"} answered.`,
        note: shorten(payload.output),
      };

    case "tool.failed":
      return {
        act: "execution",
        tone: "tone-error",
        actor,
        line: `${words.toolName(text("toolId")) ?? "The tool"} could not run.`,
        note: shorten(payload.error),
      };

    case "agent.started":
      return {
        act: "execution",
        tone: "tone-active",
        actor,
        line: actor ? `${actor} began the work.` : "An agent began the work.",
      };

    case "agent.completed":
      return {
        act: "execution",
        tone: "tone-live",
        actor,
        line: actor ? `${actor} handed the work back.` : "An agent finished.",
      };

    case "agent.failed":
      return {
        act: "execution",
        tone: "tone-error",
        actor,
        line: actor ? `${actor} could not finish.` : "An agent could not finish.",
      };

    case "task.completed":
      return {
        act: "execution",
        tone: "tone-live",
        actor,
        line: actor
          ? `${actor} finished “${task ?? "a task"}”.`
          : `“${task ?? "A task"}” was finished.`,
      };

    case "task.failed":
      return {
        act: "execution",
        tone: "tone-error",
        actor,
        line: actor
          ? `${actor} could not finish “${task ?? "a task"}”.`
          : `“${task ?? "A task"}” failed.`,
        note: text("error"),
      };

    case "task.cancelled":
      return {
        act: "execution",
        tone: "tone-idle",
        actor,
        line: `“${task ?? "A task"}” was cancelled.`,
      };

    case "approval.requested":
      return {
        act: "decisions",
        tone: "tone-warning",
        actor,
        line: `Your approval is required before “${task ?? "a step"}” can continue.`,
        note: text("reason"),
      };

    case "approval.approved":
      return {
        act: "decisions",
        tone: "tone-live",
        line: "You approved it, and the mission continued.",
      };

    case "approval.rejected":
      return {
        act: "decisions",
        tone: "tone-error",
        line: "You rejected it, and the step was not taken.",
      };

    case "artifact.created":
      return {
        act: "output",
        tone: "tone-live",
        actor,
        line: actor
          ? `${actor} produced ${text("name") ?? "an artifact"}.`
          : `${text("name") ?? "An artifact"} was produced.`,
        note: text("type"),
      };

    case "artifact.updated":
      return {
        act: "output",
        tone: "tone-idle",
        actor,
        line: `${text("name") ?? "An artifact"} was revised.`,
      };

    case "work.completed": {
      const count = number("taskCount");

      return {
        act: "output",
        tone: "tone-live",
        line: "The mission is complete.",
        note:
          count === undefined
            ? undefined
            : `${count} ${count === 1 ? "task" : "tasks"} carried it.`,
      };
    }

    case "work.failed": {
      const interrupted = number("interruptedTaskCount");

      if (interrupted !== undefined) {
        return {
          act: "execution",
          tone: "tone-warning",
          line: "Execution stopped when the process running it went away.",
          note: `${interrupted} unfinished ${
            interrupted === 1 ? "task was" : "tasks were"
          } kept, so it can resume from there.`,
        };
      }

      return {
        act: "execution",
        tone: "tone-error",
        line: "The mission stopped.",
        note: text("reason") ?? text("error"),
      };
    }

    case "work.retried":
      return {
        act: "execution",
        tone: "tone-warning",
        line:
          payload.reason === "replan" || payload.mode === "replan"
            ? "The mission was sent back to be planned again."
            : "The mission was resumed from where it stopped.",
        // Only worth saying when something actually survived; "0 finished
        // tasks were kept" is a sentence about nothing.
        note: number("preservedTaskCount")
          ? `${number("preservedTaskCount")} finished ${
              number("preservedTaskCount") === 1 ? "task was" : "tasks were"
            } kept.`
          : undefined,
      };

    case "work.cancelled":
      return {
        act: "execution",
        tone: "tone-idle",
        line: "The mission was cancelled.",
      };

    default:
      // An event type this build has not learned to say still belongs in the
      // record; it just does not get a sentence put in its mouth.
      return {
        act: "execution",
        tone: "tone-idle",
        line: event.type.replace(/[._]/g, " "),
      };
  }
}

function requirementNote(
  payload: Record<string, unknown>,
  words: Vocabulary,
): string | undefined {
  const tools = stringsOf(payload.requiredTools).map(
    (tool) => words.toolName(tool) ?? tool,
  );
  const capabilities = stringsOf(payload.requiredCapabilities);

  const parts: string[] = [];
  if (capabilities.length) parts.push(`needs ${capabilities.join(", ")}`);
  if (tools.length) parts.push(`must use ${tools.join(", ")}`);

  return parts.length ? parts.join(" · ") : undefined;
}

function delegationNote(payload: Record<string, unknown>): string | undefined {
  const delegation = payload.delegation;

  if (typeof delegation !== "object" || delegation === null) return undefined;

  const reason = (delegation as Record<string, unknown>).selectionReason;
  return typeof reason === "string" ? reason : undefined;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function shorten(value: unknown, maxChars = 130): string | undefined {
  if (value === undefined || value === null) return undefined;

  let text: string;

  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  } catch {
    return undefined;
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;

  return collapsed.length > maxChars
    ? `${collapsed.slice(0, maxChars)}…`
    : collapsed;
}
