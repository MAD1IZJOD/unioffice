import { formatRelativeTime, type AttentionItem } from "./api";

import type { Tone } from "./tone";

/**
 * Reading the attention queue.
 *
 * What needs a person, how badly, and where to act on it are all decided by
 * the backend across every row. This file only chooses the colour an entry
 * wears and how to say the whole queue in one line.
 *
 * Nothing here re-ranks or re-classifies. If the backend called something
 * information rather than an action, no surface gets a second opinion.
 */

export function attentionTone(item: AttentionItem): Tone {
  switch (item.kind) {
    case "decision":
      return "warning";
    case "failure":
    case "governance":
    case "configuration":
    case "stalled":
    case "agent_unavailable":
      // Red is for things that will not resolve themselves.
      return "error";
    case "conflict":
    case "lessons":
      return "idle";
    default:
      // An interrupted run and a retrying job are both the system still
      // holding the thread.
      return "active";
  }
}

/** Where acting on the entry happens, as the backend decided. */
export function attentionPath(item: AttentionItem): string {
  return item.action.path;
}

export function attentionTime(item: AttentionItem): string {
  return formatRelativeTime(item.at);
}

/** The single line the shell shows when the queue is not empty. */
export function summarizeAttention(items: AttentionItem[]): string {
  if (items.length === 0) return "Nothing needs your decision.";

  // Entries stopped on somebody else are summarised as that rather than
  // counted into the reader's own decisions and retries.
  const others = items.filter((item) => item.actionable === false).length;
  items = items.filter((item) => item.actionable !== false);

  const count = (...kinds: AttentionItem["kind"][]) =>
    items.filter((item) => kinds.includes(item.kind)).length;

  const parts: string[] = [];

  const decisions = count("decision");
  const stopped = count("failure", "governance");
  const stalled = count("stalled");
  const setup = count("configuration");
  const agents = count("agent_unavailable");
  const interrupted = count("interrupted");
  const review = count("conflict", "lessons");
  const recovering = count("recovering");

  if (decisions) parts.push(`${decisions} ${decisions === 1 ? "decision" : "decisions"}`);
  if (stopped) parts.push(`${stopped} stopped`);
  if (stalled) parts.push(`${stalled} stalled`);
  if (setup) parts.push(`${setup} not set up`);
  if (agents) parts.push(`${agents} blocked on an agent`);
  if (interrupted) parts.push(`${interrupted} to resume`);
  if (review) parts.push(`${review} to review`);
  if (recovering) parts.push(`${recovering} recovering`);
  if (others) parts.push(`${others} on someone else`);

  return parts.length === 0 ? "Nothing needs your decision." : parts.join(" · ");
}
