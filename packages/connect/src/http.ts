import { ConnectorError } from "./errors.js";

/**
 * One request to a provider, with the bounds every request gets.
 *
 * - A timeout, so a hung provider cannot hold a step or a worker slot.
 * - A ceiling on how many bytes are read, so a huge response is cut off in
 *   the stream rather than buffered first and measured after.
 * - No retries. A retry is a decision about someone else's rate limit and
 *   about repeating a write; neither is made silently here.
 * - Failures mapped to ConnectorError codes. The response body of a failure
 *   is never read into a message.
 */

export type Fetch = typeof fetch;

export interface ProviderRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  /** Default 10 seconds. */
  timeoutMs?: number;
  /** Default 1 MiB. */
  maxBytes?: number;
}

export interface ProviderResponse {
  status: number;
  headers: Headers;
  /** The body as text, up to maxBytes. */
  text: string;
  /** True when the body was longer than maxBytes and was cut. */
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

export async function providerRequest(
  fetchImpl: Fetch,
  url: string,
  request: ProviderRequest = {},
): Promise<ProviderResponse> {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: request.method ?? "GET",
      headers: request.headers,
      body: request.body,
      redirect: "follow",
      signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw new ConnectorError("provider_unavailable");
  }

  if (response.status >= 400) {
    // The body is released unread: nothing a provider wrote about a failure
    // is repeated anywhere.
    await response.body?.cancel().catch(() => undefined);
    throw failureFor(response);
  }

  const { text, truncated } = await readBounded(response, request.maxBytes ?? DEFAULT_MAX_BYTES);
  return { status: response.status, headers: response.headers, text, truncated };
}

/** A request whose body must be a whole JSON document. */
export async function providerJson<T = unknown>(
  fetchImpl: Fetch,
  url: string,
  request: ProviderRequest = {},
): Promise<T> {
  const response = await providerRequest(fetchImpl, url, request);

  if (response.truncated) {
    throw new ConnectorError("too_large");
  }

  if (response.status === 204 || response.text.trim() === "") {
    return undefined as T;
  }

  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new ConnectorError("malformed_response");
  }
}

function failureFor(response: Response): ConnectorError {
  const retryAfterSeconds = retryAfterOf(response.headers);

  switch (response.status) {
    case 401:
      return new ConnectorError("token_revoked");
    case 403:
      // GitHub reports an exhausted rate limit as a 403; so does its
      // secondary limit, with a retry-after.
      if (response.headers.get("x-ratelimit-remaining") === "0" || retryAfterSeconds !== undefined) {
        return new ConnectorError("rate_limited", { retryAfterSeconds });
      }
      return new ConnectorError("permission_denied");
    case 404:
    case 410:
      return new ConnectorError("not_found");
    case 422:
    case 400:
      return new ConnectorError("input_invalid");
    case 429:
      return new ConnectorError("rate_limited", { retryAfterSeconds });
    default:
      return response.status >= 500
        ? new ConnectorError("provider_unavailable")
        : new ConnectorError("malformed_response");
  }
}

function retryAfterOf(headers: Headers): number | undefined {
  const retryAfter = Number(headers.get("retry-after"));

  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(Math.ceil(retryAfter), 3600);
  }

  const reset = Number(headers.get("x-ratelimit-reset"));

  if (headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) && reset > 0) {
    return Math.max(1, Math.min(Math.ceil(reset - Date.now() / 1000), 3600));
  }

  return undefined;
}

async function readBounded(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    return { text: "", truncated: false };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) break;

      const room = maxBytes - received;

      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room));
        received += room;
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }

      chunks.push(value);
      received += value.byteLength;
    }
  } catch {
    throw new ConnectorError("provider_unavailable");
  }

  // A cut can land inside a multi-byte character; the decoder replaces the
  // partial sequence rather than throwing.
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks)), truncated };
}
