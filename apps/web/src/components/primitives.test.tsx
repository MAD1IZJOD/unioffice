import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReadFailure, StaleNotice } from "./primitives";

describe("read failures", () => {
  it("says a refusal is about access and offers no pointless retry", () => {
    render(<ReadFailure what="the workforce" error={{ status: 403, message: "You do not have permission to do that." }} onRetry={() => undefined} />);

    expect(screen.getByText("Your access doesn't include the workforce")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("separates an unreachable server from a failed load, and retries either", async () => {
    const retry = vi.fn();
    const { unmount } = render(<ReadFailure what="the missions" error={{ status: 0, message: "offline" }} onRetry={retry} />);
    expect(screen.getByText("UNIOFFICE can't reach its server")).toBeDefined();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    unmount();

    render(<ReadFailure what="the missions" error={{ status: 500, message: "x" }} />);
    expect(screen.getByText("UNIOFFICE couldn't load the missions")).toBeDefined();
  });

  it("marks stale data as stale", async () => {
    const retry = vi.fn();
    render(<StaleNotice error={{ status: 500, message: "x" }} onRetry={retry} />);

    expect(screen.getByRole("status").textContent).toMatch(/showing what was last loaded/);
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
