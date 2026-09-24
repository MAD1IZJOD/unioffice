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

test("embeddings can establish the shared subject when the titles are near restatements", () => {
  const left = { title: "Entry tier cost", content: "The cheapest plan costs $99." };
  const right = { title: "What Starter customers pay", content: "Starter customers pay $129." };

  assert.ok(subjectOverlap(left, right) < 0.6);
  assert.equal(detectConflict(left, right), null);
  assert.equal(detectConflict(left, right, 0.92)?.signals.kind, "amount");
});

test("figures about different subjects in the same area are not a conflict, however close the embeddings", () => {
  // The exact pair the live store raised as a conflict before this rule.
  const upgrades = {
    title: "A significant portion of Starter customers upgrade to the Growth tier.",
    content: "About 40% of Starter customers upgrade to Growth within a year.",
  };
  const churn = {
    title: "The current pricing strategy has two tiers with different churn rates.",
    content: "Starter churns at 6% after the second month; Growth churns at 2%.",
  };

  assert.equal(detectConflict(upgrades, churn, 0.84), null);
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

test("two entries stating the same figure agree, whatever a stray negation says", () => {
  // The exact pair a live mission raised as a conflict. Both say the total
  // cost is Rs 450,000; one adds that the figure does not include tax.
  const fact = {
    title: "The total cost of the investment is Rs 450,000.",
    content: "This calculation includes 10 new workstations at Rs 50,000 each and resale value of old machines at Rs 5,000 each, totaling Rs 50,000 from resales.",
  };
  const assumption = {
    title: "The total cost of the engineering hardware investment is Rs 450,000.",
    content: "This is derived from 10 engineers each receiving a new workstation costing Rs 50,000 and reselling old machines for Rs 5,000 each. The calculation does not include tax or depreciation.",
  };

  assert.equal(detectConflict(fact, assumption), null);
  assert.equal(detectConflict(fact, assumption, 0.95), null);
});

test("rupee amounts written as Rs or INR are compared like any other currency", () => {
  assert.deepEqual(amounts("Rs 4,50,000 and Rs. 5000 and INR 1,20,000"), [5000, 120000, 450000]);

  const conflict = detectConflict(
    { title: "The hardware budget is Rs 450,000", content: "Approved for this year." },
    { title: "The hardware budget is Rs 500,000", content: "Approved for this year." },
  );

  assert.equal(conflict?.signals.kind, "amount");
});

test("a negation still marks a conflict when no shared figure says the entries agree", () => {
  // Resolved live: identical titles, and the disagreement is in the content.
  const conflict = detectConflict(
    { title: "Support hours for the Pro plan", content: "The Pro plan includes support from 9am to 6pm on weekdays only." },
    { title: "Support hours for the Pro plan", content: "The Pro plan does not include weekday-only support; it includes 24/7 support." },
  );

  assert.equal(conflict?.signals.kind, "polarity");
});
