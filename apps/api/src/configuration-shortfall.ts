/**
 * Telling a setup problem apart from a failure.
 *
 * Most ways a mission stops are about that mission: a model was down, a step
 * threw, a rule refused it. Retrying is the answer, and the mission room is
 * where a person goes.
 *
 * Two are not. When the delegator cannot route a step because no agent in the
 * company is authorized for a tool the work needs, or because nobody works
 * here yet, the mission is fine and the company is not configured. Retrying
 * it changes nothing and will not until somebody changes the workforce, which
 * happens somewhere else entirely. Reported as "Mission stopped. Inspect." it
 * sends a person to the one place the fix is not.
 *
 * So these two are recognized, from the sentences the delegator itself writes.
 * Recognition is deliberately narrow: only text the product authored is
 * matched, never a message from anything else, because calling an ordinary
 * failure a setup problem sends a person to change the workforce over
 * something the workforce had nothing to do with.
 */

export type ConfigurationShortfall =
  /** No agent in the company may use the tools the work needs. */
  | { kind: "tools"; tools: string[] }
  /** Nobody is available to be given work at all. */
  | { kind: "workforce" };

/** At most this many tools are named; the rest are counted by the caller. */
const MAX_TOOLS = 6;

const NO_TOOL_AUTHORIZATION =
  /^No eligible agent is authorized for the required tool\(s\):\s*(.+?)\.?$/i;

const NO_AGENT_AVAILABLE = /^No active agent is available\b/i;

/**
 * The shortfall a stop reason describes, or null when it describes anything
 * else. The reason must already have been through `publicFailureReason`,
 * which is what removes the task id these sentences carry.
 */
export function configurationShortfall(reason: string | undefined): ConfigurationShortfall | null {
  if (typeof reason !== "string") return null;

  const text = reason.trim();

  if (NO_AGENT_AVAILABLE.test(text)) {
    return { kind: "workforce" };
  }

  const tools = NO_TOOL_AUTHORIZATION.exec(text);

  if (!tools) return null;

  const named = tools[1]!
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0 && tool.length <= 60);

  // A sentence that named no tool it could parse is not evidence of anything.
  return named.length > 0 ? { kind: "tools", tools: named.slice(0, MAX_TOOLS) } : null;
}
