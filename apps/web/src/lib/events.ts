import type { ActivityEvent } from "./api";

export type EventCategory =
  | "work"
  | "task"
  | "agent"
  | "tool"
  | "approval"
  | "artifact"
  | "system";

export interface DescribedEvent {
  category: EventCategory;
  /** A CSS tone class, so the caller does not re-derive colour per surface. */
  tone: "tone-live" | "tone-active" | "tone-warning" | "tone-error" | "tone-idle";
  title: string;
  detail?: string;
}

/**
 * Turns a raw event row into a line a person can read.
 *
 * The event log is the company's actual history, so this deliberately reads
 * fields off the payload rather than printing the event type verbatim: "Atlas
 * called calculator" is the story, "tool.completed" is the plumbing.
 */
export function describeEvent(event: ActivityEvent): DescribedEvent {
  const payload = event.payload ?? {};
  const text = (key: string): string | undefined => {
    const value = payload[key];
    return typeof value === "string" ? value : undefined;
  };
  const count = (key: string): number | undefined => {
    const value = payload[key];
    return typeof value === "number" ? value : undefined;
  };

  switch (event.type) {
    case "work.created":
      return {
        category: "work",
        tone: "tone-idle",
        title: "Objective received",
        detail: text("objective"),
      };

    case "work.planning_started":
      return {
        category: "work",
        tone: "tone-active",
        title: "Planning started",
        detail: text("objective"),
      };

    case "work.planning_completed":
      return {
        category: "work",
        tone: "tone-active",
        title: `Plan ready with ${count("taskCount") ?? 0} tasks`,
      };

    case "work.started":
      return {
        category: "work",
        tone: "tone-active",
        title: "Execution started",
        detail: text("objective"),
      };

    case "work.completed":
      return {
        category: "work",
        tone: "tone-live",
        title: `Work completed across ${count("taskCount") ?? 0} tasks`,
      };

    case "work.failed":
      return {
        category: "work",
        tone: "tone-error",
        title: "Work failed",
        detail: text("reason") ?? text("error"),
      };

    case "work.retried":
      return {
        category: "work",
        tone: "tone-warning",
        title:
          payload.mode === "replan"
            ? "Work retried from planning"
            : `Work resumed, ${count("resetTaskCount") ?? 0} tasks reset`,
        detail:
          count("preservedTaskCount")
            ? `${count("preservedTaskCount")} completed tasks kept`
            : undefined,
      };

    case "work.cancelled":
      return { category: "work", tone: "tone-idle", title: "Work cancelled" };

    case "task.created":
      return {
        category: "task",
        tone: "tone-idle",
        title: `Task planned: ${text("title") ?? "untitled"}`,
        detail: describeRequirements(payload),
      };

    case "task.ready":
      return {
        category: "task",
        tone: "tone-idle",
        title: `Task ready: ${text("title") ?? "untitled"}`,
      };

    case "task.started":
      return {
        category: "task",
        tone: "tone-active",
        title: `Task started: ${text("title") ?? "untitled"}`,
      };

    case "task.completed":
      return {
        category: "task",
        tone: "tone-live",
        title: `Task completed: ${text("title") ?? "untitled"}`,
      };

    case "task.failed":
      return {
        category: "task",
        tone: "tone-error",
        title: `Task failed: ${text("title") ?? "untitled"}`,
        detail: text("error"),
      };

    case "task.cancelled":
      return {
        category: "task",
        tone: "tone-idle",
        title: `Task cancelled: ${text("title") ?? "untitled"}`,
      };

    case "agent.assigned":
      return {
        category: "agent",
        tone: "tone-idle",
        title: "Task delegated to an agent",
        detail: delegationReason(payload),
      };

    case "agent.started":
      return { category: "agent", tone: "tone-active", title: "Agent started" };

    case "agent.completed":
      return { category: "agent", tone: "tone-live", title: "Agent finished" };

    case "agent.failed":
      return { category: "agent", tone: "tone-error", title: "Agent failed" };

    case "tool.called":
      return {
        category: "tool",
        tone: "tone-active",
        title: `Tool requested: ${text("toolId") ?? "unknown"}`,
      };

    case "tool.completed":
      return {
        category: "tool",
        tone: "tone-live",
        title: `Tool executed: ${text("toolId") ?? "unknown"}`,
        detail: summarizeValue(payload.output),
      };

    case "tool.failed":
      return {
        category: "tool",
        tone: "tone-error",
        title: `Tool failed: ${text("toolId") ?? "unknown"}`,
        detail: summarizeValue(payload.error),
      };

    case "approval.requested":
      return {
        category: "approval",
        tone: "tone-warning",
        title: `Approval requested: ${text("title") ?? "a task"}`,
        detail: text("reason"),
      };

    case "approval.approved":
      return {
        category: "approval",
        tone: "tone-live",
        title: "Approval granted",
        detail: text("resolvedBy") ? `by ${text("resolvedBy")}` : undefined,
      };

    case "approval.rejected":
      return {
        category: "approval",
        tone: "tone-error",
        title: "Approval rejected",
        detail: text("resolvedBy") ? `by ${text("resolvedBy")}` : undefined,
      };

    case "artifact.created":
      return {
        category: "artifact",
        tone: "tone-live",
        title: `Artifact produced: ${text("name") ?? "untitled"}`,
        detail: text("type"),
      };

    case "artifact.updated":
      return {
        category: "artifact",
        tone: "tone-idle",
        title: `Artifact updated: ${text("name") ?? "untitled"}`,
      };

    default:
      return {
        category: "system",
        tone: "tone-idle",
        title: event.type.replace(/[._]/g, " "),
      };
  }
}

export const eventCategories: Array<{
  id: EventCategory | "all";
  label: string;
}> = [
  { id: "all", label: "Everything" },
  { id: "work", label: "Work" },
  { id: "task", label: "Tasks" },
  { id: "agent", label: "Agents" },
  { id: "tool", label: "Tools" },
  { id: "approval", label: "Approvals" },
  { id: "artifact", label: "Artifacts" },
];

function describeRequirements(payload: Record<string, unknown>): string | undefined {
  const tools = Array.isArray(payload.requiredTools)
    ? (payload.requiredTools as unknown[]).filter(
        (tool): tool is string => typeof tool === "string",
      )
    : [];
  const capabilities = Array.isArray(payload.requiredCapabilities)
    ? (payload.requiredCapabilities as unknown[]).filter(
        (capability): capability is string => typeof capability === "string",
      )
    : [];

  const parts: string[] = [];
  if (tools.length) parts.push(`needs ${tools.join(", ")}`);
  if (capabilities.length) parts.push(capabilities.join(", "));

  return parts.length ? parts.join(" · ") : undefined;
}

function delegationReason(payload: Record<string, unknown>): string | undefined {
  const delegation = payload.delegation;

  if (typeof delegation !== "object" || delegation === null) {
    return undefined;
  }

  const reason = (delegation as Record<string, unknown>).selectionReason;
  return typeof reason === "string" ? reason : undefined;
}

/** Keeps a tool payload to a single scannable line. */
export function summarizeValue(value: unknown, maxChars = 120): string | undefined {
  if (value === undefined || value === null) return undefined;

  const text = typeof value === "string" ? value : safeStringify(value);
  if (!text) return undefined;

  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > maxChars
    ? `${collapsed.slice(0, maxChars)}…`
    : collapsed;
}

export function safeStringify(value: unknown, indent = 0): string {
  try {
    return JSON.stringify(value, null, indent) ?? "";
  } catch {
    return "";
  }
}
