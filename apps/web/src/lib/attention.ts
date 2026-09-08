import { formatRelativeTime, type CompanyOverview } from "./api";
import type { Tone } from "./tone";

export type AttentionKind = "decision" | "failure" | "recovering";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  tone: Tone;
  /** What it is, in three or four words. */
  label: string;
  /** Why it is here. */
  detail: string;
  /** What happens next, or what the person can do. */
  consequence: string;
  /** Where acting on it happens. */
  to: string;
  when?: string;
}

/**
 * One definition of "what needs me right now", shared by every surface.
 *
 * Before this, the rail badge counted approvals, the Command Center opening
 * counted approvals and failures, and the popover counted approvals plus the
 * two most recent events - three different answers to the same question, on
 * one screen. Everything here comes from a real row: a pending approval, a
 * work item the backend marked failed, or one it marked interrupted. Nothing
 * is invented to keep the list from being empty, because an empty list is the
 * correct and common answer.
 */
export function collectAttention(
  overview: CompanyOverview | undefined,
): AttentionItem[] {
  if (!overview) return [];

  const decisions: AttentionItem[] = overview.approvals.map((approval) => ({
    id: approval.id,
    kind: "decision",
    tone: "warning",
    label: approval.action,
    detail: approval.reason,
    consequence: "The work is stopped until you decide.",
    to: "/approvals",
    when: approval.createdAt,
  }));

  const settled = [
    ...overview.work.active,
    ...overview.work.recentlyCompleted,
  ];

  const failures: AttentionItem[] = [];
  const recovering: AttentionItem[] = [];

  for (const work of settled) {
    if (work.status !== "failed") continue;

    // An interrupted run is a process that died mid-way, not a run that went
    // wrong. It is recoverable, and calling it a failure trains people to
    // ignore the word.
    if (work.metadata.interrupted) {
      recovering.push({
        id: work.id,
        kind: "recovering",
        tone: "active",
        label: "Interrupted mid-run",
        detail: work.objective,
        consequence: "Completed tasks were kept. It can be resumed.",
        to: `/work/${work.id}`,
        when: work.updatedAt,
      });
      continue;
    }

    failures.push({
      id: work.id,
      kind: "failure",
      tone: "error",
      label: "Work failed",
      detail:
        typeof work.metadata.executionError === "string"
          ? work.metadata.executionError
          : work.objective,
      consequence: "It can be retried from where it stopped.",
      to: `/work/${work.id}`,
      when: work.completedAt ?? work.updatedAt,
    });
  }

  return [...decisions, ...failures, ...recovering];
}

/** The single line the shell shows when the queue is not empty. */
export function summarizeAttention(items: AttentionItem[]): string {
  if (items.length === 0) return "Nothing needs your decision.";

  const decisions = items.filter((item) => item.kind === "decision").length;
  const failures = items.filter((item) => item.kind === "failure").length;
  const recovering = items.filter((item) => item.kind === "recovering").length;

  const parts: string[] = [];
  if (decisions) parts.push(`${decisions} ${decisions === 1 ? "decision" : "decisions"}`);
  if (failures) parts.push(`${failures} ${failures === 1 ? "failure" : "failures"}`);
  if (recovering) parts.push(`${recovering} to resume`);

  return parts.join(" · ");
}

export function attentionTime(item: AttentionItem): string {
  return formatRelativeTime(item.when);
}
