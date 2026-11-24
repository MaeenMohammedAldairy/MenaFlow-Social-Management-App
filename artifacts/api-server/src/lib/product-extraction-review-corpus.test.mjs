import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeProductExtractionResponse } from "./product-extraction.ts";

/**
 * Replays the fixtures exported from merchant field reviews
 * (`pnpm run db:export:product-review-fixtures`). The file is absent until a
 * merchant has reviewed something, so the corpus test skips instead of failing;
 * once committed it becomes the regression corpus that a prompt or model change
 * is measured against.
 */
const corpusUrl = new URL(
  "./product-extraction.reviewed.jsonl",
  import.meta.url,
);

let cases = [];
try {
  cases = (await readFile(corpusUrl, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

test(
  "reviewed extraction fixtures still replay through production normalization",
  (context) => {
    if (cases.length === 0) {
      context.skip("no reviewed fixtures exported yet");
      return;
    }
    for (const benchmarkCase of cases) {
      assert.match(benchmarkCase.caseId, /^rev-[0-9a-f]{12}$/, "hashed case id");
      assert.equal(benchmarkCase.source, "merchant_review");
      assert.ok(benchmarkCase.messages.length > 0, benchmarkCase.caseId);

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
      for (const field of benchmarkCase.incorrectFields) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(benchmarkCase.verdicts, field),
          `${benchmarkCase.caseId}: ${field} recorded as incorrect`,
        );
      }
    }
  },
);
