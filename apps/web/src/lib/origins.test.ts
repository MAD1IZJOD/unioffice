import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedOrigins, redirectOrigin, redirectTo } from "./origins";

/** Serves the page from `origin` for one test. */
function servedFrom(origin: string) {
  const url = new URL(origin);
  vi.stubGlobal("window", { location: { origin: url.origin, hostname: url.hostname } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("where sign-in may return to", () => {
  it("allows the application and development, and nothing else", () => {
    const allowed = allowedOrigins();

    expect(allowed).toContain("https://unioffice.pro");
    expect(allowed).toContain("http://localhost:5173");
    expect(allowed).not.toContain("https://unioffice.online");
  });

  it("returns people to the page they signed in from when it is one we know", () => {
    servedFrom("https://unioffice.pro");
    expect(redirectOrigin()).toBe("https://unioffice.pro");

    servedFrom("http://localhost:5173");
    expect(redirectOrigin()).toBe("http://localhost:5173");
  });

  it("sends people to the application when the page is served from somewhere else", () => {
    servedFrom("https://unioffice.pro.attacker.example");
    expect(redirectOrigin()).toBe("https://unioffice.pro");

    servedFrom("http://localhost.evil.example");
    expect(redirectOrigin()).toBe("https://unioffice.pro");
  });

  it("keeps a redirect on its own origin, whatever path it is handed", () => {
    servedFrom("https://unioffice.pro");

    expect(redirectTo("/missions")).toBe("https://unioffice.pro/missions");
    expect(redirectTo("//evil.example/steal")).toBe("https://unioffice.pro/");
    expect(redirectTo("https://evil.example")).toBe("https://unioffice.pro/");
    expect(redirectTo()).toBe("https://unioffice.pro/");
  });
});
