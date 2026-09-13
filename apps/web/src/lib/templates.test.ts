import { describe, expect, it } from "vitest";

import { TEMPLATE_INPUT_LIMITS } from "./api";
import { validateTemplateInput } from "./templates";

const valid = {
  name: "",
  objective: "Review the quarter's burn against plan.",
  context: "",
  desiredOutcome: "A one-page summary.",
  constraints: "",
};

describe("validateTemplateInput", () => {
  it("accepts a complete answer with the optional fields left empty", () => {
    expect(validateTemplateInput(valid)).toEqual({});
  });

  it("asks for an objective and an outcome, ignoring surrounding whitespace", () => {
    const errors = validateTemplateInput({
      ...valid,
      objective: "   go    ",
      desiredOutcome: "  ",
    });

    expect(Object.keys(errors).sort()).toEqual(["desiredOutcome", "objective"]);
  });

  it("uses the same limits the API enforces for every field", () => {
    const errors = validateTemplateInput({
      name: "n".repeat(TEMPLATE_INPUT_LIMITS.name + 1),
      objective: "o".repeat(TEMPLATE_INPUT_LIMITS.objective + 1),
      context: "c".repeat(TEMPLATE_INPUT_LIMITS.context + 1),
      desiredOutcome: "d".repeat(TEMPLATE_INPUT_LIMITS.desiredOutcome + 1),
      constraints: "k".repeat(TEMPLATE_INPUT_LIMITS.constraints + 1),
    });

    expect(Object.keys(errors).sort()).toEqual([
      "constraints",
      "context",
      "desiredOutcome",
      "name",
      "objective",
    ]);
    expect(errors.objective).toMatch(/1000 characters or fewer/);
  });

  it("allows a field at exactly its limit", () => {
    expect(
      validateTemplateInput({
        ...valid,
        constraints: "k".repeat(TEMPLATE_INPUT_LIMITS.constraints),
      }),
    ).toEqual({});
  });
});
