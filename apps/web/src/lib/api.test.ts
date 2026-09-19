import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubNetwork } from "../test/network";

import { humaneMessage, launchWork, setActiveOrganization } from "./api";

describe("error messages people read", () => {
  it("never shows a server fault's own words", () => {
    const message = humaneMessage(500, "An internal error occurred.");
    expect(message).toMatch(/couldn't complete that right now/);
    expect(message).not.toMatch(/internal/i);
    expect(humaneMessage(503, undefined)).toMatch(/try again/);
  });

  it("keeps the API's message when it is something the person can act on", () => {
    expect(humaneMessage(403, "You do not have permission to do that.")).toBe("You do not have permission to do that.");
    expect(humaneMessage(409, "This skill changed since you opened it.")).toBe("This skill changed since you opened it.");
  });

  it("explains an ended session rather than repeating a status", () => {
    expect(humaneMessage(401, "Sign in to continue.")).toMatch(/Sign in again/);
  });
});

describe("starting a mission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveOrganization(undefined);
  });

  it("asks the server to plan and queue it in one request, and does not wait for the plan", async () => {
    const calls = stubNetwork(() => json(202, { launched: true, workId: "work-1" }));
    setActiveOrganization("org-1");

    const result = await launchWork("work-1");

    expect(result).toEqual({ launched: true, workId: "work-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url.pathname).toBe("/work/work-1/launch");
    expect(calls.some((call) => call.url.pathname.endsWith("/plan"))).toBe(false);
    expect(calls.some((call) => call.url.pathname.endsWith("/execute"))).toBe(false);
  });

  it("passes on the server's reason when the mission is already being planned", async () => {
    stubNetwork(() => json(409, { error: { code: "CONFLICT", message: "This mission is already being planned." } }));

    await expect(launchWork("work-1")).rejects.toThrow("This mission is already being planned.");
  });
});

