import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useResource } from "./useResource";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("polling", () => {
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("does not poll while the tab is hidden, and reads at once when it returns", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => "data");

    renderHook(() => useResource(load, { pollMs: 1_000 }));
    await act(async () => { await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => { setVisibility("hidden"); });
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => { setVisibility("visible"); });
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("stops listening when the page goes away", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useResource(async () => 1, { pollMs: 1_000 }));

    unmount();
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});
