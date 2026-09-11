import { formatRelativeTime, type AttentionItem } from "./api";

import type { Tone } from "./tone";

/**
 * Reading the attention queue.
 *
 * Deciding what needs a person used to happen here, over whatever slice of
 * the company the overview payload happened to carry. It happens in the
 * service layer now, across every row, which is why this file is down to
 * presentation: which colour an entry wears, where acting on it happens, and
 * how to say the whole queue in one line.
 *
 * Nothing here re-ranks or re-classifies. If the backend called something
 * information rather than an action, the drawer does not get a second
 * opinion about it.
 */

export function attentionTone(item: AttentionItem): Tone {
  switch (item.kind) {
    case "decision":
      return "warning";
    case "failure":
      return "error";
    default:
      // An interrupted run and a retrying job are both the system still
      // holding the thread. Blue, not red: red is for things that are not
      // going to resolve themselves.
      return "active";
  }
}

/**
 * Where the entry is acted on.
 *
 * Always the mission, never a list of decisions detached from what they are
 * holding up - approving something you cannot see the consequences of is the
 * failure mode this avoids.
 */
export function attentionPath(item: AttentionItem): string {
  return `/missions/${item.workId}`;
}

export function attentionTime(item: AttentionItem): string {
  return formatRelativeTime(item.at);
}

/** The single line the shell shows when the queue is not empty. */
export function summarizeAttention(items: AttentionItem[]): string {
  if (items.length === 0) return "Nothing needs your decision.";

  const count = (kind: AttentionItem["kind"]) =>
    items.filter((item) => item.kind === kind).length;

  const decisions = count("decision");
  const failures = count("failure");
  const interrupted = count("interrupted");
  const recovering = count("recovering");

  const parts: string[] = [];

  if (decisions) {
    parts.push(`${decisions} ${decisions === 1 ? "decision" : "decisions"}`);
  }

  if (failures) {
    parts.push(`${failures} ${failures === 1 ? "failure" : "failures"}`);
  }

  if (interrupted) parts.push(`${interrupted} to resume`);
  if (recovering) parts.push(`${recovering} recovering`);

  return parts.join(" · ");
}
