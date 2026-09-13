import { vi } from "vitest";

/**
 * A stand-in for the API at the network boundary.
 *
 * Only `fetch` is replaced. The page, its hooks and the real client in
 * lib/api.ts all run as they do in the browser, so a test sees the same
 * requests, parsing and error handling a person would.
 */

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
}

export type Route = (call: RecordedCall) => Response | Promise<Response>;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function stubNetwork(route: Route): RecordedCall[] {
  const calls: RecordedCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const call: RecordedCall = {
        method: (init.method ?? "GET").toUpperCase(),
        url: new URL(String(input)),
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      };

      calls.push(call);
      return route(call);
    }),
  );

  return calls;
}

/** A response the test releases when it has looked at the waiting state. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}
