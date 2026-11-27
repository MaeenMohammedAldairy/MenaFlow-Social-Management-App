/**
 * The schema must allow what the code writes.
 *
 * This is not a style rule. In the live workspace the suggestions table carried
 * an older `CHECK (status IN ('review','draft_created','possible_duplicate',
 * 'dismissed'))` next to a newer wide one, so every write of `superseded` — the
 * status the version chain depends on — was refused by the database. Six
 * re-extractions died on it and left nothing behind but a `failed` row. A
 * migration that widens the constraint is only correct as long as somebody
 * remembers to widen it, so the comparison lives in a test instead.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PRODUCT_EXTRACTION_LIST_STATUSES,
} from "./product-extraction-list-policy.ts";
import { EXTRACTION_REASON_CODES } from "./product-extraction-reasons.ts";
import { productExtractionMediaStateMessage } from "./product-extraction-media-policy.ts";

const MIGRATION = new URL(
  "../../../../supabase/migrations/20261127000000_product_extraction_simplification.sql",
  import.meta.url,
);

/** The bare words inside a `CHECK (col IN ('a', 'b'))` list. */
function quotedValues(block) {
  return [...block.matchAll(/'([A-Za-z_]+)'/g)].map((match) => match[1]);
}

function checkBlock(pattern) {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = sql.match(pattern);
  assert.ok(match, `the migration no longer contains ${pattern}`);
  return match[1];
}

test("the migration allows every suggestion status the app can write", () => {
  // `dismissed` is never listed by the queue but is written by the dismiss
  // endpoint, so it belongs in the set the database has to accept.
  const writable = [...PRODUCT_EXTRACTION_LIST_STATUSES, "dismissed"].sort();
  const allowed = [...quotedValues(
    checkBlock(/mena_product_extraction_status_check\s*\n?\s*CHECK \(status IN \(([\s\S]*?)\)\);/),
  )].sort();
  assert.deepEqual(
    writable.filter((status) => !allowed.includes(status)),
    [],
    "a status the code writes but the database refuses is a silent failure",
  );
});

test("the migration allows every reason code the worker records", () => {
  const allowed = quotedValues(
    checkBlock(/reason_code IS NULL OR reason_code IN \(([\s\S]*?)\)\);/),
  ).sort();
  const recorded = [...EXTRACTION_REASON_CODES].sort();
  assert.deepEqual(
    recorded.filter((code) => !allowed.includes(code)),
    [],
  );
  assert.deepEqual(
    allowed.filter((code) => !recorded.includes(code)),
    [],
    "a reason the database accepts but nothing can write is a dead state",
  );
});

test("the media states the suggestion can carry are the ones the table allows", () => {
  const allowed = quotedValues(
    checkBlock(/media_state IN \(([\s\S]*?)\)\);/),
  ).sort();
  assert.deepEqual(allowed, [
    "included",
    "lost",
    "not_applicable",
    "partial",
    "pending",
  ]);
  // Every state the database can hold has to have words: `ProductExtractionMediaState`
  // is an exhaustive switch, so a state added on one side and not the other
  // returns `undefined` here instead of rendering a blank review card.
  for (const state of allowed) {
    assert.equal(
      typeof productExtractionMediaStateMessage(state),
      "string",
      `no explanation for media_state=${state}`,
    );
    assert.ok(productExtractionMediaStateMessage(state).length > 0);
  }
});
