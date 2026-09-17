import { describe, expect, it } from "vitest";

import { whyItExists } from "./knowledge";

describe("why knowledge exists", () => {
  it("names a person who added it", () => {
    expect(whyItExists({ sourceType: "user", status: "active", createdBy: "user:1" }, { author: "madhavan@example.test" }).origin)
      .toBe("Added by madhavan@example.test");
  });

  it("never presents unreviewed system-derived knowledge as settled", () => {
    const learned = whyItExists({ sourceType: "task", status: "active", createdBy: "system" });
    expect(learned.origin).toBe("Learned from completed work");
    expect(learned.unconfirmed).toBe(true);
    expect(learned.standing).toMatch(/never reviewed/);

    const proposed = whyItExists({ sourceType: "agent", status: "proposed" });
    expect(proposed.standing).toMatch(/claim, not a fact/);
  });

  it("says when a person confirmed it, or when it was retired", () => {
    expect(whyItExists({ sourceType: "artifact", status: "active", reviewedAt: "2026-09-01" })).toEqual({
      origin: "Extracted from an artifact and approved",
      standing: "Confirmed by a person.",
      unconfirmed: false,
    });
    expect(whyItExists({ sourceType: "task", status: "archived" }).standing).toMatch(/Archived/);
  });
});
