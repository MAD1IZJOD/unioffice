import assert from "node:assert/strict";
import test from "node:test";

import { jsonTransformTool } from "./json-transform-tool.js";
import type { ToolExecutionContext } from "../tool.js";

const context: ToolExecutionContext = {
  organizationId: "org-1",
  authorizedToolIds: ["json_transform"],
  metadata: {},
};

test("pick keeps only the requested keys", async () => {
  const validation = jsonTransformTool.validate({
    operation: "pick",
    data: { a: 1, b: 2, c: 3 },
    keys: ["a", "c"],
  });
  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);
  assert.deepEqual(output, { a: 1, c: 3 });
});

test("omit drops the requested keys", async () => {
  const validation = jsonTransformTool.validate({
    operation: "omit",
    data: { a: 1, b: 2, c: 3 },
    keys: ["b"],
  });
  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);
  assert.deepEqual(output, { a: 1, c: 3 });
});

test("filter_equals keeps only matching array items", async () => {
  const validation = jsonTransformTool.validate({
    operation: "filter_equals",
    data: [{ status: "open" }, { status: "closed" }, { status: "open" }],
    field: "status",
    equals: "open",
  });
  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);
  assert.deepEqual(output, [{ status: "open" }, { status: "open" }]);
});

test("map_field projects a single field from every array item", async () => {
  const validation = jsonTransformTool.validate({
    operation: "map_field",
    data: [{ name: "Mike" }, { name: "Tony" }],
    field: "name",
  });
  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);
  assert.deepEqual(output, ["Mike", "Tony"]);
});

test("rejects mismatched data shapes at validation time", () => {
  assert.equal(
    jsonTransformTool.validate({ operation: "pick", data: [1, 2], keys: ["a"] }).valid,
    false,
  );
  assert.equal(
    jsonTransformTool.validate({ operation: "filter_equals", data: { a: 1 }, field: "a", equals: 1 }).valid,
    false,
  );
  assert.equal(
    jsonTransformTool.validate({ operation: "unsupported", data: {} }).valid,
    false,
  );
});

test("pick applies to every item when given an array of objects", async () => {
  // The regression this exists for: an agent asked to keep name and region
  // from a list of records found pick rejected arrays, cycled through every
  // other operation, and gave up after exhausting its tool budget.
  const validation = jsonTransformTool.validate({
    operation: "pick",
    data: [
      { name: "Acme", region: "EMEA", arr: 120000, owner: "kim" },
      { name: "Globex", region: "APAC", arr: 88000, owner: "ravi" },
    ],
    keys: ["name", "region"],
  });

  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);

  assert.deepEqual(output, [
    { name: "Acme", region: "EMEA" },
    { name: "Globex", region: "APAC" },
  ]);
});

test("omit applies to every item when given an array of objects", async () => {
  const validation = jsonTransformTool.validate({
    operation: "omit",
    data: [
      { name: "Acme", secret: "x" },
      { name: "Globex", secret: "y" },
    ],
    keys: ["secret"],
  });

  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);

  assert.deepEqual(output, [{ name: "Acme" }, { name: "Globex" }]);
});

test("pick still works on a single object", async () => {
  const validation = jsonTransformTool.validate({
    operation: "pick",
    data: { name: "Acme", region: "EMEA", arr: 120000 },
    keys: ["name", "region"],
  });

  assert.ok(validation.valid);
  const output = await jsonTransformTool.execute(validation.value, context);

  assert.deepEqual(output, { name: "Acme", region: "EMEA" });
});

test("pick rejects an array that is not entirely objects", async () => {
  const result = jsonTransformTool.validate({
    operation: "pick",
    data: [{ name: "Acme" }, "not an object"],
    keys: ["name"],
  });

  assert.equal(result.valid, false);
});
