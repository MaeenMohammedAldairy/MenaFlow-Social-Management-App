import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeProductExtractionResponse } from "./product-extraction.ts";

const benchmarkUrl = new URL(
  "./product-extraction.synthetic.jsonl",
  import.meta.url,
);
const cases = (await readFile(benchmarkUrl, "utf8"))
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

test("synthetic product extraction benchmark targets satisfy production normalization", () => {
  assert.equal(cases.length, 6);

  for (const benchmarkCase of cases) {
    const normalized = normalizeProductExtractionResponse(
      JSON.stringify(benchmarkCase.target),
      benchmarkCase.messages,
    );
    assert.equal(
      normalized.candidates.length,
      benchmarkCase.target.products.length +
        benchmarkCase.target.nonProductMessageIds.length,
      benchmarkCase.caseId,
    );
  }
});

test("synthetic benchmark keeps conflicting prices and incomplete products for review", () => {
  const conflicting = cases.find(
    ({ caseId }) => caseId === "syn-003-conflicting-prices",
  );
  const incomplete = cases.find(
    ({ caseId }) => caseId === "syn-006-incomplete-product",
  );

  assert.ok(conflicting);
  assert.ok(incomplete);

  const conflictResult = normalizeProductExtractionResponse(
    JSON.stringify(conflicting.target),
    conflicting.messages,
  ).candidates[0];
  const incompleteResult = normalizeProductExtractionResponse(
    JSON.stringify(incomplete.target),
    incomplete.messages,
  ).candidates[0];

  assert.equal(conflictResult.data.price, null);
  assert.equal(conflictResult.complete, false);
  assert.equal(incompleteResult.data.name, "مصباح LED صغير");
  assert.equal(incompleteResult.complete, false);
});
