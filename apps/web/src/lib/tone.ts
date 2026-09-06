import type { AgentPresence, TaskStatus, WorkStatus } from "./api";

/**
 * One shared status vocabulary. Every surface in the product reads the same
 * five tones, so amber always means "a human is needed" and red always means
 * "this did not work" - a page that invents its own colours makes the whole
 * control plane harder to scan.
 */
export type Tone = "live" | "active" | "warning" | "error" | "idle";

export const toneClass: Record<Tone, string> = {
  live: "tone-live",
  active: "tone-active",
  warning: "tone-warning",
  error: "tone-error",
  idle: "tone-idle",
};

export function workStatusTone(status: WorkStatus): Tone {
  switch (status) {
    case "completed":
      return "live";
    case "executing":
    case "planning":
      return "active";
    case "waiting_approval":
      return "warning";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

export function taskStatusTone(status: TaskStatus): Tone {
  switch (status) {
    case "completed":
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

export function presenceTone(presence: AgentPresence): Tone {
  switch (presence) {
    case "working":
      return "active";
    case "waiting":
      return "warning";
    case "blocked":
      return "error";
    case "available":
      return "live";
    default:
      return "idle";
  }
}

/** Turns a snake_case status into something readable in a pill. */
export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}
