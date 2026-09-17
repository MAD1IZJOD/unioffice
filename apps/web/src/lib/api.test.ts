import { describe, expect, it } from "vitest";

import { humaneMessage } from "./api";

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
