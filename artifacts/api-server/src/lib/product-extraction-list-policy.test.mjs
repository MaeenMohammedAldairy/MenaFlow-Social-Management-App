import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCT_EXTRACTION_LIST_MAX_LIMIT,
  PRODUCT_EXTRACTION_LIST_MAX_OFFSET,
  buildProductExtractionPagination,
  parseProductExtractionListQuery,
  summarizeProductExtractionSuggestions,
} from "./product-extraction-list-policy.ts";

test("no query at all is today's behaviour: everything but dismissed, newest first", () => {
  assert.deepEqual(parseProductExtractionListQuery({}), {
    ok: true,
    classification: null,
    statuses: [],
    limit: 50,
    offset: 0,
  });
  assert.equal(PRODUCT_EXTRACTION_LIST_MAX_LIMIT, 50);
});

test("classification accepts both real values and nothing else", () => {
  assert.equal(
    parseProductExtractionListQuery({ classification: "product" }).classification,
    "product",
  );
  assert.equal(
    parseProductExtractionListQuery({ classification: "not_product" })
      .classification,
    "not_product",
  );
  assert.equal(
    parseProductExtractionListQuery({ classification: " PRODUCT " })
      .classification,
    "product",
  );
  assert.equal(
    parseProductExtractionListQuery({ classification: "   " }).classification,
    null,
  );
  assert.deepEqual(parseProductExtractionListQuery({ classification: "maybe" }), {
    ok: false,
    error: "قيمة التصنيف غير صالحة.",
  });
});

test("case is not part of the contract", () => {
  assert.deepEqual(
    parseProductExtractionListQuery({ status: "REVIEW,Draft_Created" }).statuses,
    ["review", "draft_created"],
  );
  assert.deepEqual(parseProductExtractionListQuery({ status: "DISMISSED" }), {
    ok: false,
    error: "حالة الاقتراح غير صالحة.",
  });
});

test("status is repeatable and comma separated, deduplicated, order preserved", () => {
  assert.deepEqual(
    parseProductExtractionListQuery({ status: ["review", "possible_duplicate"] })
      .statuses,
    ["review", "possible_duplicate"],
  );
  assert.deepEqual(
    parseProductExtractionListQuery({ status: "review,draft_created,review" })
      .statuses,
    ["review", "draft_created"],
  );
  assert.deepEqual(parseProductExtractionListQuery({ status: " , " }).statuses, []);
  assert.deepEqual(parseProductExtractionListQuery({ status: [] }).statuses, []);
});

test("every product-update outcome can be filtered and counted", () => {
  const statuses = [
    "update_proposed",
    "accepted_update",
    "rejected_update",
    "superseded",
  ];
  assert.deepEqual(
    parseProductExtractionListQuery({ status: statuses.join(",") }).statuses,
    statuses,
  );
  const counts = summarizeProductExtractionSuggestions(
    statuses.map((status) => ({
      classification: "product",
      status,
      total: 1,
    })),
  );
  assert.equal(counts.updateProposed, 1);
  assert.equal(counts.acceptedUpdate, 1);
  assert.equal(counts.rejectedUpdate, 1);
  assert.equal(counts.superseded, 1);
});

test("dismissed is not a filter: those suggestions stay hidden", () => {
  assert.deepEqual(parseProductExtractionListQuery({ status: "dismissed" }), {
    ok: false,
    error: "حالة الاقتراح غير صالحة.",
  });
  assert.deepEqual(
    parseProductExtractionListQuery({ status: "review,dismissed" }),
    { ok: false, error: "حالة الاقتراح غير صالحة." },
  );
});

test("an unknown status is rejected rather than silently ignored", () => {
  assert.deepEqual(parseProductExtractionListQuery({ status: "approved" }), {
    ok: false,
    error: "حالة الاقتراح غير صالحة.",
  });
});

test("limit and offset clamp instead of failing, so a stale client still works", () => {
  assert.equal(parseProductExtractionListQuery({ limit: "10" }).limit, 10);
  assert.equal(parseProductExtractionListQuery({ limit: "0" }).limit, 1);
  assert.equal(parseProductExtractionListQuery({ limit: "5000" }).limit, 50);
  assert.equal(parseProductExtractionListQuery({ limit: "abc" }).limit, 50);
  assert.equal(parseProductExtractionListQuery({ limit: "-3" }).limit, 1);
  assert.equal(parseProductExtractionListQuery({ limit: "12.9" }).limit, 12);
  assert.equal(parseProductExtractionListQuery({ offset: "50" }).offset, 50);
  assert.equal(parseProductExtractionListQuery({ offset: "-1" }).offset, 0);
  assert.equal(parseProductExtractionListQuery({ offset: "abc" }).offset, 0);
  assert.equal(
    parseProductExtractionListQuery({ offset: "99999999" }).offset,
    PRODUCT_EXTRACTION_LIST_MAX_OFFSET,
  );
});

test("express array-shaped values are read like single ones", () => {
  assert.equal(parseProductExtractionListQuery({ limit: ["7"] }).limit, 7);
  assert.equal(
    parseProductExtractionListQuery({ classification: ["product"] })
      .classification,
    "product",
  );
});

test("the summary separates products from post candidates", () => {
  const counts = summarizeProductExtractionSuggestions([
    { classification: "not_product", status: "review", total: 18 },
    { classification: "product", status: "draft_created", total: 2 },
    { classification: "product", status: "review", total: 3 },
    { classification: "product", status: "possible_duplicate", total: 1 },
  ]);
  assert.deepEqual(counts, {
    total: 24,
    product: 6,
    notProduct: 18,
    pendingReview: 21,
    pendingProductReview: 3,
    draftCreated: 2,
    possibleDuplicate: 1,
    updateProposed: 0,
    acceptedUpdate: 0,
    rejectedUpdate: 0,
    superseded: 0,
  });
});

test("an empty catalog summarizes to zeros, not to missing keys", () => {
  assert.deepEqual(summarizeProductExtractionSuggestions([]), {
    total: 0,
    product: 0,
    notProduct: 0,
    pendingReview: 0,
    pendingProductReview: 0,
    draftCreated: 0,
    possibleDuplicate: 0,
    updateProposed: 0,
    acceptedUpdate: 0,
    rejectedUpdate: 0,
    superseded: 0,
  });
});

test("rows of an unknown classification still count towards the total", () => {
  const counts = summarizeProductExtractionSuggestions([
    { classification: "mystery", status: "review", total: 2 },
  ]);
  assert.equal(counts.total, 2);
  assert.equal(counts.product, 0);
  assert.equal(counts.notProduct, 0);
  assert.equal(counts.pendingReview, 2);
});

test("a non-positive or non-numeric row count is read as zero", () => {
  const counts = summarizeProductExtractionSuggestions([
    { classification: "product", status: "review", total: -4 },
    { classification: "product", status: "draft_created", total: Number.NaN },
  ]);
  assert.equal(counts.total, 0);
  assert.equal(counts.product, 0);
});

test("pagination points at the next page only while rows remain", () => {
  assert.deepEqual(
    buildProductExtractionPagination({ total: 20, limit: 50, offset: 0 }),
    { total: 20, limit: 50, offset: 0, nextOffset: null },
  );
  assert.deepEqual(
    buildProductExtractionPagination({ total: 120, limit: 50, offset: 0 }),
    { total: 120, limit: 50, offset: 0, nextOffset: 50 },
  );
  assert.deepEqual(
    buildProductExtractionPagination({ total: 120, limit: 50, offset: 100 }),
    { total: 120, limit: 50, offset: 100, nextOffset: null },
  );
  assert.deepEqual(
    buildProductExtractionPagination({ total: 0, limit: 50, offset: 50 }),
    { total: 0, limit: 50, offset: 50, nextOffset: null },
  );
});

test("a page total is clamped to the same bounds as the request", () => {
  const page = buildProductExtractionPagination({
    total: -5,
    limit: 5000,
    offset: -2,
  });
  assert.deepEqual(page, { total: 0, limit: 50, offset: 0, nextOffset: null });
});
