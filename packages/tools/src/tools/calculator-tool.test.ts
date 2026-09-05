import assert from "node:assert/strict";
import test from "node:test";

import { calculatorTool } from "./calculator-tool.js";
import type { ToolExecutionContext } from "../tool.js";

const context: ToolExecutionContext = {
  organizationId: "org-1",
  authorizedToolIds: ["calculator"],
  metadata: {},
};

async function evaluate(expression: string): Promise<number> {
  const validation = calculatorTool.validate({ expression });
  assert.ok(validation.valid, "expected expression to validate");
  const output = await calculatorTool.execute(validation.value, context);
  return output.result;
}

test("evaluates basic arithmetic with correct precedence", async () => {
  assert.equal(await evaluate("2 + 3 * 4"), 14);
  assert.equal(await evaluate("(2 + 3) * 4"), 20);
  assert.equal(await evaluate("10 - 2 - 3"), 5);
});

test("supports exponents right-associatively", async () => {
  assert.equal(await evaluate("2 ^ 3 ^ 2"), 512);
});

test("supports unary minus and modulo", async () => {
  assert.equal(await evaluate("-5 + 10"), 5);
  assert.equal(await evaluate("10 % 3"), 1);
});

test("rejects division by zero", async () => {
  const validation = calculatorTool.validate({ expression: "1 / 0" });
  assert.ok(validation.valid);
  await assert.rejects(() => calculatorTool.execute(validation.value, context));
});

test("rejects unsupported characters", () => {
  const validation = calculatorTool.validate({ expression: "2 + alert(1)" });
  assert.ok(validation.valid, "structural validation only checks shape, not evaluability");
  return assert.rejects(() => calculatorTool.execute(validation.value, context));
});

test("rejects non-string or empty expressions at validation time", () => {
  assert.equal(calculatorTool.validate({ expression: "" }).valid, false);
  assert.equal(calculatorTool.validate({ expression: 5 }).valid, false);
  assert.equal(calculatorTool.validate({}).valid, false);
});
