import assert from "node:assert/strict";
import test from "node:test";

import { amounts, detectConflict, percentages, subjectOverlap } from "./conflict-detector.js";

test("two prices for the same thing are a conflict, and the reason names both", () => {
  const conflict = detectConflict(
    { title: "Pricing starts at $99", content: "The Starter plan is $99 per month." },
    { title: "Pricing starts at $129", content: "The Starter plan is $129 per month." },
  );

  assert.ok(conflict);
  assert.equal(conflict.signals.kind, "amount");
  assert.match(conflict.reason, /99 vs 129/);
});

test("the same price stated twice is not a conflict", () => {
  assert.equal(
    detectConflict(
      { title: "Pricing starts at $99", content: "Starter is $99." },
      { title: "Pricing starts at $99 per month", content: "The entry tier costs $99 monthly." },
    ),
    null,
  );
});

test("amounts written differently but equal do not conflict", () => {
  assert.deepEqual(amounts("Budget is $1.5k"), [1500]);
  assert.deepEqual(amounts("Budget is 1,500 USD"), [1500]);
  assert.equal(
    detectConflict(
      { title: "Launch budget", content: "Budget is $1.5k." },
      { title: "Launch budget", content: "Budget is 1,500 USD." },
    ),
    null,
  );
});

test("different figures about different subjects are not a conflict", () => {
  assert.equal(
    detectConflict(
      { title: "Office lease renews in March", content: "Rent is $4,000 a month." },
      { title: "Pricing starts at $99", content: "Starter is $99." },
    ),
    null,
  );
});

test("different percentages for the same target conflict", () => {
  assert.deepEqual(percentages("Margin target is 70% and churn is 3.5 %"), [3.5, 70]);

  const conflict = detectConflict(
    { title: "Gross margin target", content: "We target 70% gross margin." },
    { title: "Gross margin target", content: "We target 65% gross margin." },
  );

  assert.equal(conflict?.signals.kind, "percentage");
});

test("one entry negating the other is a conflict", () => {
  const conflict = detectConflict(
    { title: "We sell through resellers", content: "Resellers are a primary channel." },
    { title: "We do not sell through resellers", content: "Resellers are not used." },
  );

  assert.equal(conflict?.signals.kind, "polarity");
});

test("embeddings can establish the shared subject when the titles are worded apart", () => {
  const left = { title: "Entry tier cost", content: "The cheapest plan costs $99." };
  const right = { title: "What Starter customers pay", content: "Starter customers pay $129." };

  assert.ok(subjectOverlap(left, right) < 0.6);
  assert.equal(detectConflict(left, right), null);
  assert.equal(detectConflict(left, right, 0.86)?.signals.kind, "amount");
});

test("an entry with a figure and one without is not evidence of disagreement", () => {
  assert.equal(
    detectConflict(
      { title: "Pricing starts at $99", content: "Starter is $99." },
      { title: "Pricing starts low", content: "Starter is our cheapest plan." },
      0.9,
    ),
    null,
  );
});
