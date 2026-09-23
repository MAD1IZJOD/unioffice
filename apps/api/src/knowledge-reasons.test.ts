import assert from "node:assert/strict";
import test from "node:test";

import { readableRecallReason, readableRecallReasons } from "./knowledge-reasons.js";

/**
 * The line between explaining a choice and handing someone a number they
 * cannot act on.
 */

test("a raw similarity is taken off the sentence, and the sentence survives", () => {
  assert.equal(
    readableRecallReason("Matched the topic of the work (similarity 0.71)"),
    "Matched the topic of the work",
  );
});

test("every measurement the ranker writes is recognized", () => {
  for (const [written, shown] of [
    ["Matched the topic of the work (similarity 0.7)", "Matched the topic of the work"],
    ["Ranked first (score 12.5)", "Ranked first"],
    ["Close match (MATCH 0.9)", "Close match"],
  ] as const) {
    assert.equal(readableRecallReason(written), shown);
  }
});

test("a reason with something to say in brackets keeps it", () => {
  for (const reason of [
    "Shares the terms “tier”, “churn”",
    "Recorded for this workspace (Finance)",
    "Reviewed by a person",
    "Marked critical to the company",
  ]) {
    assert.equal(readableRecallReason(reason), reason);
  }
});

test("a measurement in the middle of a sentence is not what this removes", () => {
  assert.equal(
    readableRecallReason("Matched (similarity 0.71) the topic of the work"),
    "Matched (similarity 0.71) the topic of the work",
  );
});

test("a reason that was nothing but its measurement leaves no empty line behind", () => {
  assert.deepEqual(
    readableRecallReasons(["(similarity 0.71)", "Shares the terms “tier”"]),
    ["Shares the terms “tier”"],
  );
});
