import assert from "node:assert/strict";
import test from "node:test";

import { datetimeTool } from "./datetime-tool.js";
import type { ToolExecutionContext } from "../tool.js";

const context: ToolExecutionContext = {
  organizationId: "org-1",
  authorizedToolIds: ["datetime"],
  metadata: {},
};

test("now returns a valid ISO timestamp", async () => {
  const validation = datetimeTool.validate({ operation: "now" });
  assert.ok(validation.valid);
  const output = await datetimeTool.execute(validation.value, context);
  assert.equal(output.operation, "now");
  assert.ok(output.operation === "now" && !Number.isNaN(Date.parse(output.iso)));
});

test("add advances an ISO timestamp by the given unit", async () => {
  const validation = datetimeTool.validate({
    operation: "add",
    isoDate: "2026-01-01T00:00:00.000Z",
    amount: 3,
    unit: "days",
  });
  assert.ok(validation.valid);
  const output = await datetimeTool.execute(validation.value, context);
  assert.deepEqual(output, { operation: "add", iso: "2026-01-04T00:00:00.000Z" });
});

test("add accepts negative amounts", async () => {
  const validation = datetimeTool.validate({
    operation: "add",
    isoDate: "2026-01-04T00:00:00.000Z",
    amount: -1,
    unit: "days",
  });
  assert.ok(validation.valid);
  const output = await datetimeTool.execute(validation.value, context);
  assert.deepEqual(output, { operation: "add", iso: "2026-01-03T00:00:00.000Z" });
});

test("diff computes the delta between two timestamps in the requested unit", async () => {
  const validation = datetimeTool.validate({
    operation: "diff",
    fromIso: "2026-01-01T00:00:00.000Z",
    toIso: "2026-01-02T12:00:00.000Z",
    unit: "hours",
  });
  assert.ok(validation.valid);
  const output = await datetimeTool.execute(validation.value, context);
  assert.deepEqual(output, { operation: "diff", value: 36, unit: "hours" });
});

test("rejects invalid ISO timestamps and units at validation time", () => {
  assert.equal(
    datetimeTool.validate({ operation: "add", isoDate: "not-a-date", amount: 1, unit: "days" }).valid,
    false,
  );
  assert.equal(
    datetimeTool.validate({
      operation: "diff",
      fromIso: "2026-01-01T00:00:00.000Z",
      toIso: "2026-01-02T00:00:00.000Z",
      unit: "fortnights",
    }).valid,
    false,
  );
  assert.equal(datetimeTool.validate({ operation: "unsupported" }).valid, false);
});
