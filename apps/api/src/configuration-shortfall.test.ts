import assert from "node:assert/strict";
import test from "node:test";

import { configurationShortfall } from "./configuration-shortfall.js";
import { publicFailureReason } from "./public-failure.js";

/**
 * What counts as the company not being set up, and - more importantly - what
 * does not. Every false positive here sends a person to the workforce page
 * over something the workforce did not cause.
 */

test("a step nobody is authorized for names the tools that would fix it", () => {
  const reason = publicFailureReason(
    "No eligible agent is authorized for the required tool(s): calculator (task: 7f9c2b10-0000-4000-8000-00000000000a)",
  );

  assert.deepEqual(configurationShortfall(reason), { kind: "tools", tools: ["calculator"] });
});

test("several tools are all named, in the order the delegator wrote them", () => {
  const reason = publicFailureReason(
    "No eligible agent is authorized for the required tool(s): calculator, web_search (task: 7f9c2b10-0000-4000-8000-00000000000a)",
  );

  assert.deepEqual(configurationShortfall(reason), { kind: "tools", tools: ["calculator", "web_search"] });
});

test("a company with nobody in it reads as having no workforce, not as a tool problem", () => {
  const reason = publicFailureReason("No active agent is available for task: 7f9c2b10-0000-4000-8000-00000000000a");

  assert.deepEqual(configurationShortfall(reason), { kind: "workforce" });
});

test("the sentence an earlier delegator wrote is still recognized", () => {
  // Missions that stopped 18 days ago are still in the store carrying it.
  const reason = publicFailureReason("No eligible agents available for task: 7d82be15-57a5-4588-8608-76b7caf6190f");

  assert.equal(reason, "No eligible agents available.");
  assert.deepEqual(configurationShortfall(reason), { kind: "workforce" });
});

test("an ordinary failure is not a setup problem", () => {
  for (const reason of [
    "The local model was unavailable when this ran.",
    "The company's records could not be read or written at that moment.",
    "The step returned nothing usable.",
    "A rule refused the step.",
    "No agents were available to review the figures.",
    "The eligible agents available to this workspace all declined.",
    undefined,
    "",
  ]) {
    assert.equal(configurationShortfall(reason), null, `"${reason ?? "undefined"}"`);
  }
});

test("a failure that merely mentions a tool is not a setup problem", () => {
  assert.equal(
    configurationShortfall("The calculator tool returned an error while dividing by zero."),
    null,
  );
});

test("text shaped like the sentence but naming nothing is not evidence", () => {
  assert.equal(configurationShortfall("No eligible agent is authorized for the required tool(s): "), null);
});

test("the tools named are bounded, so one sentence cannot fill a page", () => {
  const many = Array.from({ length: 20 }, (_, index) => `tool_${index}`).join(", ");
  const shortfall = configurationShortfall(`No eligible agent is authorized for the required tool(s): ${many}`);

  assert.equal(shortfall?.kind, "tools");
  assert.equal(shortfall?.kind === "tools" ? shortfall.tools.length : 0, 6);
});
