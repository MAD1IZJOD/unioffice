import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api";

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** True only on the first load, so a refresh never blanks the page. */
  loading: boolean;
  /** True while a background refresh is in flight. */
  refreshing: boolean;
  reload: () => void;
}

interface ResourceState<T> {
  data?: T;
  error?: ApiError;
  settled: boolean;
  refreshing: boolean;
}

/**
 * Loads one API resource and keeps it fresh.
 *
 * The distinction between `loading` and `refreshing` is the whole point: a
 * poll that flipped `loading` back to true would tear the page down to a
 * skeleton every few seconds, which reads as broken rather than live.
 *
 * `load` must be stable (wrap it in useCallback) - it is an effect dependency
 * rather than a ref, so a genuinely new loader re-fetches instead of being
 * silently ignored.
 */
export function useResource<T>(
  load: () => Promise<T>,
  options: { pollMs?: number; enabled?: boolean } = {},
): Resource<T> {
  const { pollMs, enabled = true } = options;

  const [state, setState] = useState<ResourceState<T>>({
    settled: false,
    refreshing: false,
  });

  // Only used to decide whether an in-flight request should still be applied,
  // never read during render.
  const activeRequest = useRef(0);

  const run = useCallback(async () => {
    const requestId = activeRequest.current + 1;
    activeRequest.current = requestId;

    setState((current) =>
      current.settled ? { ...current, refreshing: true } : current,
    );

    try {
      const data = await load();
      if (activeRequest.current !== requestId) return;

      setState({ data, error: undefined, settled: true, refreshing: false });
    } catch (caught) {
      if (activeRequest.current !== requestId) return;

      setState((current) => ({
        data: current.data,
        error:
          caught instanceof ApiError
            ? caught
            : new ApiError(
                (caught as Error)?.message ?? "Something went wrong.",
                0,
              ),
        settled: true,
        refreshing: false,
      }));
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return;

    void run();

    if (!pollMs) {
      return () => {
        // Abandon any in-flight result rather than applying it after unmount.
        activeRequest.current += 1;
      };
    }

    const interval = setInterval(() => void run(), pollMs);

    return () => {
      activeRequest.current += 1;
      clearInterval(interval);
    };
  }, [enabled, pollMs, run]);

  return {
    data: state.data,
    error: state.error,
    loading: enabled && !state.settled,
    refreshing: state.refreshing,
    reload: run,
  };
}
