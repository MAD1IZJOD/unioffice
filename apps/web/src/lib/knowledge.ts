import type {
  KnowledgeItem,
  KnowledgeSourceType,
  KnowledgeStatus,
  KnowledgeType,
} from "./api";

import type { Tone } from "./tone";

/**
 * Reading company knowledge.
 *
 * The backend decides what a piece of knowledge is, whether it is current,
 * where it came from and why it was retrieved. This file only chooses the
 * words and the colour, so nothing on the page can reach a different
 * conclusion than the data did.
 */

export const KNOWLEDGE_KINDS: Array<{
  type: KnowledgeType;
  label: string;
  meaning: string;
}> = [
  { type: "decision", label: "Decision", meaning: "A choice the company made" },
  { type: "fact", label: "Fact", meaning: "Something established as true" },
  { type: "insight", label: "Insight", meaning: "An interpretation drawn from analysis" },
  { type: "lesson", label: "Lesson", meaning: "Kept so it is not repeated" },
  { type: "assumption", label: "Assumption", meaning: "Taken as true, not established" },
  { type: "policy", label: "Policy", meaning: "A rule the company operates by" },
  { type: "process", label: "Process", meaning: "How something is done here" },
  { type: "preference", label: "Preference", meaning: "A stated preference" },
  { type: "reference", label: "Reference", meaning: "Somewhere worth looking" },
  { type: "experience", label: "Record", meaning: "A raw trace of work that ran" },
];

/** Kinds a person can record by hand; the raw execution record is not one. */
export const WRITABLE_KINDS = KNOWLEDGE_KINDS.filter(
  (kind) => kind.type !== "experience",
);

export function kindLabel(type: KnowledgeType): string {
  return KNOWLEDGE_KINDS.find((kind) => kind.type === type)?.label ?? type;
}

export function kindMeaning(type: KnowledgeType): string {
  return KNOWLEDGE_KINDS.find((kind) => kind.type === type)?.meaning ?? "";
}

/**
 * Blue is knowledge the company currently stands on. A proposal needs a
 * person, which is the same amber an approval wears everywhere else. Archived
 * knowledge is history and reads quietly.
 */
export function knowledgeStatusTone(status: KnowledgeStatus): Tone {
  switch (status) {
    case "active":
      return "active";
    case "proposed":
      return "warning";
    default:
      return "idle";
  }
}

export function knowledgeStatusLabel(status: KnowledgeStatus): string {
  switch (status) {
    case "active":
      return "Current";
    case "proposed":
      return "Proposed";
    default:
      return "Archived";
  }
}

export function sourceLabel(sourceType: KnowledgeSourceType): string {
  switch (sourceType) {
    case "task":
      return "From a mission step";
    case "artifact":
      return "From an artifact";
    case "user":
      return "Written by a person";
    case "agent":
      return "Proposed by an agent";
    case "approval":
      return "From an approval decision";
    default:
      return "From a mission";
  }
}

/**
 * Why a piece of knowledge exists, in one sentence a person can weigh.
 *
 * Where it came from, and whether anyone has confirmed it. Anything derived
 * by the system and not yet reviewed says so plainly: the company's memory is
 * not allowed to present an AI's conclusion as settled fact.
 */
export function whyItExists(
  item: Pick<KnowledgeItem, "sourceType" | "status" | "reviewedAt" | "createdBy">,
  names: { author?: string } = {},
): { origin: string; standing: string; unconfirmed: boolean } {
  const person = names.author ?? "a person";

  const origin = (() => {
    switch (item.sourceType) {
      case "user":
        return `Added by ${person}`;
      case "task":
        return "Learned from completed work";
      case "artifact":
        return item.reviewedAt ? "Extracted from an artifact and approved" : "Extracted from an artifact";
      case "approval":
        return "Recorded from an approval decision";
      case "agent":
        return "Proposed by an agent";
      default:
        return "Learned from a mission";
    }
  })();

  const derived = item.sourceType !== "user" && item.sourceType !== "approval";

  if (item.status === "archived") {
    return { origin, standing: "Archived - kept for the record, no longer handed to agents.", unconfirmed: false };
  }

  if (item.reviewedAt) {
    return { origin, standing: "Confirmed by a person.", unconfirmed: false };
  }

  if (derived) {
    return {
      origin,
      standing: item.status === "proposed"
        ? "Derived by the system and not yet reviewed - treat it as a claim, not a fact."
        : "Derived by the system and never reviewed by a person - weigh it accordingly.",
      unconfirmed: true,
    };
  }

  return { origin, standing: item.status === "proposed" ? "Waiting for review." : "Recorded directly.", unconfirmed: false };
}

/** "user:…", "agent:…" or "system", said as who rather than as an id. */
export function actorLabel(actor?: string): string {
  if (!actor) return "unrecorded";
  if (actor.startsWith("user:")) return "a person";
  if (actor.startsWith("agent:")) return "an agent";
  return "the system";
}

/** Where knowledge applies, from the only field that decides it. */
export function reachLabel(item: Pick<KnowledgeItem, "workspaceId">, workspaceName?: string): string {
  if (!item.workspaceId) return "Company-wide";
  return workspaceName ? `Only in ${workspaceName}` : "Only in one workspace";
}

const SIGNAL_WORDS: Record<string, string> = {
  ignore_instructions: "tells an AI to ignore its instructions",
  reveal_secrets: "asks for secrets to be revealed",
  role_override: "tries to change an AI's role",
  tool_directive: "tells an AI to call a tool",
  approval_directive: "tries to approve or bypass governance",
  delimiter_spoof: "imitates a system boundary",
};

export function flagSentence(flags: string[]): string {
  const words = flags.map((flag) => SIGNAL_WORDS[flag] ?? flag.replace(/_/g, " "));
  return `This text ${words.join(", and ")}. Agents receive it only as quoted data, with a warning, and it can change nothing they are permitted to do.`;
}

export function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}`;
}

export function importanceWord(value: number): string {
  if (value >= 0.9) return "Critical";
  if (value >= 0.7) return "High";
  if (value >= 0.4) return "Normal";
  return "Low";
}

/** An ISO timestamp for "created in the last N days". */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
