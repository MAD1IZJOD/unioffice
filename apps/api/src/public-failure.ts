/**
 * Saying why something stopped, to a person.
 *
 * What the backend records when work fails is written for whoever debugs it:
 * a model server's crash output, a database driver's message, the id of the
 * task that could not be routed. Stored as-is it is the right record. Shown
 * as-is it tells a person nothing they can act on and hands out internals -
 * on the live store a failed mission's reason read, verbatim, "llama-server
 * process has terminated: exit status 1: ggml_backend_cpu_buffer_type_alloc_
 * buffer: failed".
 *
 * So anything leaving the API on an operational surface passes through here.
 * Failures from infrastructure are named by what they mean. Failures the
 * product itself phrased - "No eligible agent is authorized for the required
 * tool(s): calculator" - keep their words, with identifiers, stack traces and
 * embedded payloads taken out and the length bounded.
 */

const MAX_REASON_CHARS = 240;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const MODEL_UNAVAILABLE =
  /\b(ollama|llama[-_ ]?server|ggml|model provider|model request failed|econnrefused|fetch failed|socket hang up|timed out waiting)\b/i;

const STORAGE_FAILURE =
  /\b(supabase|postgres|postgrest|pgrst|violates .* constraint|relation "[^"]*" does not exist|duplicate key)\b|^failed to (create|update|find|read|delete|claim|tail)\b/i;

export const MODEL_UNAVAILABLE_REASON = "The local model was unavailable when this ran.";

export const STORAGE_FAILURE_REASON = "The company's records could not be read or written at that moment.";

export function publicFailureReason(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;

  // Only the first line is ever a message; the rest of a thrown error is its
  // stack, and a stack is exactly what must not travel.
  const firstLine = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";

  if (!firstLine) return undefined;

  if (MODEL_UNAVAILABLE.test(firstLine)) return MODEL_UNAVAILABLE_REASON;
  if (STORAGE_FAILURE.test(firstLine)) return STORAGE_FAILURE_REASON;

  const cleaned = firstLine
    // An embedded response body, e.g. `...(500): {"error": "..."}`.
    .replace(/[:\s]*\{.*\}\s*$/s, "")
    // "(task: <id>)" and "for task: <id>" name a row, not a reason.
    .replace(/\s*\((?:task|work|agent|job)s?:\s*[^)]*\)/gi, "")
    .replace(/\s*(?:for|of)?\s*(?:task|work|agent|job):\s*[0-9a-f-]{36}\b/gi, "")
    .replace(UUID, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[:;,\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!cleaned) return undefined;

  const sentence = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;

  return sentence.length <= MAX_REASON_CHARS
    ? sentence
    : `${sentence.slice(0, MAX_REASON_CHARS - 1).trimEnd()}…`;
}
