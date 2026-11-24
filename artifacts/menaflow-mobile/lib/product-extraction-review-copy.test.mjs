import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

/**
 * Drift gate between the review queue's three slices and the server that lists
 * them.
 *
 * The mobile modules import `@workspace/api-client-react`, so they cannot be
 * imported from a node test; the convention here is to read the sources instead.
 * What this protects is narrow and concrete: a filter chip that sends a value the
 * server rejects turns the whole review tab into a 400, and a badge that counts
 * the wrong rows tells the merchant they owe decisions they do not owe.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "../../api-server/src");
const read = (...parts) => readFileSync(path.resolve(here, ...parts), "utf8");

const serverPolicy = readFileSync(
  path.join(serverRoot, "lib/product-extraction-list-policy.ts"),
  "utf8",
);
const serverRoute = readFileSync(
  path.join(serverRoot, "routes/product-extractions.ts"),
  "utf8",
);
const mobileClient = read("product-catalog-api.ts");
const mobileScreen = read("../components/products/ProductCatalogScreen.tsx");

/** Quoted string literals inside a captured TypeScript fragment. */
function literals(fragment) {
  return [...fragment.matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

function captured(source, pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `could not find ${label}`);
  return match[1];
}

test("the classification values the app sends are the ones the server accepts", () => {
  const server = literals(
    captured(serverPolicy, /const CLASSIFICATIONS = \[([^\]]*)\]/, "server CLASSIFICATIONS"),
  );
  const client = literals(
    captured(
      mobileClient,
      /classification\?: ([^;]*);/,
      "client classification union",
    ),
  );
  assert.deepEqual(server, ["product", "not_product"]);
  assert.deepEqual([...client].sort(), [...server].sort());
});

test("the status values the app sends are the ones the server accepts", () => {
  const server = literals(
    captured(serverPolicy, /const STATUSES = \[([^\]]*)\]/, "server STATUSES"),
  );
  const client = literals(
    captured(
      mobileClient,
      /export type ProductExtractionListStatus =([^;]*);/,
      "client status union",
    ),
  );
  assert.deepEqual(server, [
    "review",
    "draft_created",
    "possible_duplicate",
    "update_proposed",
    "accepted_update",
    "rejected_update",
    "superseded",
  ]);
  assert.deepEqual([...client].sort(), [...server].sort());
});

test("dismissed is not something a client can ask for", () => {
  assert.ok(
    serverPolicy.includes('return { ok: false, error: "حالة الاقتراح غير صالحة." }'),
    "the server must reject an unknown or dismissed status",
  );
  const clientStatuses = literals(
    captured(
      mobileClient,
      /export type ProductExtractionListStatus =([^;]*);/,
      "client list status union",
    ),
  );
  assert.ok(!clientStatuses.includes("dismissed"));
});

test("an unknown filter is rejected, not silently widened", () => {
  assert.ok(
    serverRoute.includes("res.status(400).json({ error: listQuery.error })"),
    "the list route must answer 400 for a filter it cannot honour",
  );
});

test("each slice asks the server for exactly its own rows", () => {
  const definitions = captured(
    mobileScreen,
    /const extractionFilterDefinitions[\s\S]*?= (\[[\s\S]*?\n\];)/,
    "extractionFilterDefinitions",
  );
  const slices = definitions
    .split(/\n  \},\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.includes("id: "));
  assert.equal(slices.length, 4, "the review queue has four slices");

  const pending = slices.find((slice) => slice.includes('"pending"'));
  assert.ok(pending, "a pending slice");
  assert.ok(pending.includes('classification: "product"'));
  assert.ok(pending.includes('statuses: ["review"]'));

  const processed = slices.find((slice) => slice.includes('"processed"'));
  assert.ok(processed, "a processed slice");
  assert.ok(
    processed.includes('"update_proposed"') &&
      processed.includes('"accepted_update"') &&
      processed.includes('"rejected_update"') &&
      processed.includes('"superseded"'),
    "processed rows include every update outcome",
  );
  const updates = slices.find((slice) => slice.includes('"updates"'));
  assert.ok(updates, "an update-proposals slice");
  assert.ok(updates.includes('"update_proposed"'));
  assert.ok(
    !processed.includes("classification"),
    "processed suggestions are counted of either classification",
  );

  const notProduct = slices.find((slice) => slice.includes('"not_product"'));
  assert.ok(notProduct, "a not_product slice");
  assert.ok(notProduct.includes('classification: "not_product"'));
});

test("the badge counts review work, not every row the queue holds", () => {
  assert.ok(
    mobileScreen.includes("extractionCounts.pendingProductReview"),
    "the tab badge must come from the server's own count",
  );
  assert.ok(
    !mobileScreen.includes("extractionSuggestions.length + (candidates.data?.length ?? 0)"),
    "scanned post candidates are a different list and must not inflate the badge",
  );
  // Counts are taken from the first page, so they describe the whole queue
  // rather than only the rows loaded so far.
  assert.ok(
    mobileScreen.includes("extractionPages[0]?.suggestionCounts"),
  );
});

test("the queue is paged on the server, so it is not capped at one page", () => {
  assert.ok(mobileScreen.includes("useInfiniteQuery({"));
  assert.ok(mobileScreen.includes("initialPageParam: 0"));
  assert.ok(
    mobileScreen.includes("getNextPageParam: (lastPage) => lastPage.pagination.nextOffset"),
  );
  assert.ok(mobileScreen.includes("limit: PRODUCT_EXTRACTION_PAGE_SIZE"));
  assert.ok(mobileScreen.includes("offset: pageParam"));
  assert.ok(
    mobileScreen.includes("extractionPagination.nextOffset !== null"),
    "there must be a way to reach the rows after the first page",
  );
});

test("the app's page size is inside the server's bound", () => {
  const client = Number(
    captured(
      mobileClient,
      /export const PRODUCT_EXTRACTION_PAGE_SIZE = (\d+);/,
      "client page size",
    ),
  );
  const server = Number(
    captured(
      serverPolicy,
      /export const PRODUCT_EXTRACTION_LIST_MAX_LIMIT = (\d+);/,
      "server max limit",
    ),
  );
  assert.ok(client > 0 && client <= server, `${client} must fit in ${server}`);
});

test("the rejected-message slice says what it is, so it is not read as a failure", () => {
  assert.ok(mobileScreen.includes("NOT_PRODUCT_FILTER_NOTE"));
  assert.ok(
    mobileScreen.includes("وليست عمل مراجعة"),
    "the note must say these rows are not review work",
  );
});

test("messages with nothing readable are counted and explained", () => {
  // Their jobs complete, so no other counter mentions them: six such messages sat
  // on the live workspace with nothing on screen to say where they went.
  assert.ok(mobileClient.includes("noText: number;"));
  assert.ok(mobileClient.includes("noText: 0,"));
  assert.ok(mobileScreen.includes("counts.noText > 0"));
  assert.ok(
    mobileScreen.includes("بلا نص مقروء"),
    "the strip must say why nothing was extracted",
  );
  assert.ok(
    mobileScreen.includes("اكتب وصف المنتج مع الصورة"),
    "and what the merchant can do about it",
  );
  assert.ok(serverRoute.includes('eq(whatsappProductExtractionJobs.lastError, "PRODUCT_TEXT_REQUIRED")'));
});
