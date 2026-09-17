import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App";
import { AccessContext } from "./lib/access";
import type { FeatureItem } from "./lib/api";
import { FALLBACK_FEATURES } from "./lib/navigation";
import { signedInAs } from "./test/access";
import { json, stubNetwork } from "./test/network";

/**
 * The application shell: a rail built from the features the API reports, a
 * breadcrumb, the product version, and a plain statement when the device goes
 * offline.
 */

function features(overrides: (feature: FeatureItem) => FeatureItem = (feature) => feature): FeatureItem[] {
  return FALLBACK_FEATURES.map(overrides);
}

function open(path: string, list: FeatureItem[] = features()) {
  stubNetwork((call) => {
    if (call.url.pathname === "/features") return json(200, { product: { name: "UNIOFFICE", version: "2.1" }, features: list });
    return json(503, { error: { code: "UNAVAILABLE", message: "Not in this test." } });
  });

  const router = createMemoryRouter(
    [{ path: "/", element: <AccessContext.Provider value={signedInAs("owner")}><App /></AccessContext.Provider>, children: [{ path: "*", element: <div>page</div> }] }],
    { initialEntries: [path] },
  );

  render(<RouterProvider router={router} />);
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

afterEach(() => setOnline(true));

describe("the shell", () => {
  it("builds the rail from the features the server reports, with Skills under Workforce", async () => {
    open("/skills", features((feature) =>
      feature.id === "connections" ? { ...feature, status: "needs_configuration", note: "needs an OAuth client" } : feature));

    const rail = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    expect(within(rail).getByText("Workforce")).toBeDefined();
    expect(within(rail).getByRole("link", { name: /Skills/ }).getAttribute("href")).toBe("/skills");
    expect(await within(rail).findByLabelText("Needs configuration")).toBeDefined();
    expect(screen.getAllByText("OPERATING SYSTEM 2.1").length).toBeGreaterThan(0);
  });

  it("hides a feature the server does not list for this person", async () => {
    open("/command", features().filter((feature) => feature.id !== "members"));

    const rail = screen.getAllByRole("navigation", { name: "Main" })[0]!;
    await waitFor(() => expect(within(rail).queryByRole("link", { name: /Members/ })).toBeNull());
    expect(within(rail).getByRole("link", { name: /Skills/ })).toBeDefined();
  });

  it("says so when the device goes offline, and stops saying it when it returns", async () => {
    open("/command");

    await act(async () => setOnline(false));
    expect(screen.getByRole("alert").textContent).toMatch(/offline/);
    expect(screen.getByText("OFFLINE")).toBeDefined();

    await act(async () => setOnline(true));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
