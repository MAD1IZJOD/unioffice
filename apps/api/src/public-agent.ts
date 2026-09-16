import type { Agent } from "@unioffice/core";

/**
 * An agent as a person may be shown it.
 *
 * An agent's metadata holds the instructions its model is given and the
 * seed's bookkeeping - nothing an interface renders, and not something that
 * belongs in a browser. Everything the product shows about an agent is in its
 * other fields, so the metadata is dropped wherever an agent leaves the API.
 */
export function publicAgent(agent: Agent): Agent {
  return { ...agent, metadata: {} };
}
