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
/**
 * `lib/api-spec/openapi.yaml` is now where the client's unions come from: the
 * mobile module imports the generated client, which is built from this file. So
 * the drift that matters is between the server's policy and the contract — the
 * contract-to-client link is already gated by `codegen` reporting NO DRIFT, and
 * the client-to-module link by the TypeScript build.
 */
const contract = readFileSync(
  path.resolve(here, "../../../lib/api-spec/openapi.yaml"),
  "utf8",
);
const mobileClient = read("product-catalog-api.ts");
const mobileScreen = read("../components/products/ProductCatalogScreen.tsx");

/** Quoted string literals inside a captured TypeScript fragment. */
function literals(fragment) {
  return [...fragment.matchAll(/"([^"]+)"/g)].map(([, value]) => value);
}

/** The text of one `paths` entry, from its key to the next path key. */
function pathBlock(path) {
  const start = contract.indexOf(`\n  ${path}:\n`);
  assert.ok(start !== -1, `the contract must document ${path}`);
  const rest = contract.slice(start + 1);
  const end = rest.indexOf("\n  /");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The text of one named schema, from its key to the next schema key. */
function schemaBlock(name) {
  const start = contract.indexOf(`\n    ${name}:\n`);
  assert.ok(start !== -1, `the contract must define ${name}`);
  const rest = contract.slice(start + 1);
  const end = rest.search(/\n    [A-Za-z][A-Za-z0-9]*:\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * The items of a list under `key:` inside a fragment, whether the YAML writes it
 * as a block list or in flow style (`[a, b]`).
 */
function listItems(fragment, key) {
  const flow = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(fragment);
  if (flow) {
    return flow[1].split(",").map((value) =>
      value.trim().replace(/^["']|["']$/g, ""),
    );
  }
  // The last item of a sliced block has no trailing newline, so add one.
  const match = new RegExp(`${key}:\\s*\\n((?:\\s+-[^\\n]*\\n)+)`).exec(
    `${fragment}\n`,
  );
  assert.ok(match, `could not find a ${key} list`);
  return [...match[1].matchAll(/-\s+(.+)$/gm)].map(([, value]) =>
    value.trim().replace(/^["']|["']$/g, ""),
  );
}

/**
 * The columns of one `pgTable` in the Drizzle schema, by their TypeScript property
 * names — which are the keys the row is serialised with.
 */
function tableColumns(table) {
  const schema = readFileSync(
    path.resolve(here, "../../../lib/db/src/schema/products.ts"),
    "utf8",
  );
  const start = schema.indexOf(`export const ${table} = pgTable`);
  assert.ok(start !== -1, `the schema must define ${table}`);
  const block = schema.slice(start).split("\n);")[0];
  const columns = [
    ...block.matchAll(/^ {4}([a-zA-Z_][A-Za-z0-9_]*):/gm),
  ].map(([, name]) => name);
  assert.ok(columns.length > 5, `parsed ${columns.length} columns of ${table}`);
  return columns;
}

/** The top-level property names of one schema in the contract. */
function contractProperties(name) {
  const block = schemaBlock(name);
  const lines = block.split("\n");
  const start = lines.findIndex((line) => line === "      properties:");
  assert.ok(start !== -1, `${name} must declare properties`);
  const names = [];
  for (const line of lines.slice(start + 1)) {
    if (/^      \S/.test(line)) break; // left the properties block
    const match = /^        ([a-zA-Z_][A-Za-z0-9_]*):$/.exec(line);
    if (match) names.push(match[1]);
  }
  assert.ok(names.length > 5, `parsed ${names.length} properties of ${name}`);
  return names;
}

/**
 * A response built as `{...row, ...extras}` can only ever carry the row's columns
 * plus those extras. Documenting anything else describes a field that is never on
 * the wire, and the compiler will not object — the client just reads `undefined`
 * forever. That is how `evidenceSpans` and `confidenceReasons` both sat in the
 * contract as optional fields nothing ever sent.
 */
function assertDocumentedFieldsExist(type, table, extras) {
  const sendable = new Set([...tableColumns(table), ...extras]);
  const phantom = contractProperties(type).filter((name) => !sendable.has(name));
  assert.deepEqual(
    phantom,
    [],
    `${type} documents fields the server never sends: ${phantom.join(", ")}`,
  );
}

test("a media upload is sendable by the generated client", () => {
  // Three things have to agree or every upload 400s: the content type the
  // contract declares (which a code generator pins as a literal), the content
  // types the server's raw parser accepts, and the parameter that carries the
  // real type. It broke once — the contract said `image/*`, the server's
  // `typeis` filter treats a wildcard as a literal type, so the generated client
  // could never upload anything.
  const media = pathBlock("/social/products/media");
  const contentTypes = [...media.matchAll(/^          ([a-z]+\/[a-z*+-]+):$/gm)].map(
    ([, type]) => type,
  );
  assert.deepEqual(
    contentTypes,
    ["application/octet-stream"],
    "the contract must declare exactly one concrete content type",
  );
  assert.ok(
    media.includes("name: mediaType"),
    "the contract must offer a parameter to carry the real type",
  );

  const route = readFileSync(
    path.join(serverRoot, "routes/product-media.ts"),
    "utf8",
  );
  assert.ok(
    route.includes('"application/octet-stream"'),
    "the server must accept the content type the contract declares",
  );

  assert.ok(
    mobileClient.includes("{ mediaType: asset.mimeType }"),
    "the client must send the real type alongside the octet-stream body",
  );
});

test("the documented suggestion shape is what the route actually spreads", () => {
  assertDocumentedFieldsExist(
    "ProductExtractionSuggestion",
    "productExtractionSuggestions",
    [
      "sources",
      "missingFields",
      "missingFieldMessages",
      "possibleDuplicateProducts",
      // Derived beside the row, in the server's words: the mobile card reads it
      // (`productExtractionMediaNote`), and `mediaState` alone is a column the
      // merchant cannot interpret.
      "mediaStateMessage",
    ],
  );
});

test("the documented catalog product shape is what the route actually spreads", () => {
  assertDocumentedFieldsExist("CatalogProduct", "products", [
    "mediaPreviews",
    "postIds",
    "missingFields",
    "missingFieldMessages",
    "publicationBlockers",
    "publicationBlockerMessages",
    "publicationBlocked",
    "advisoryFields",
    "publicationHistory",
  ]);
});

function captured(source, pattern, label) {
  const match = pattern.exec(source);
  assert.ok(match, `could not find ${label}`);
  return match[1];
}

test("the classification values the app sends are the ones the server accepts", () => {
  const server = literals(
    captured(serverPolicy, /const CLASSIFICATIONS = \[([^\]]*)\]/, "server CLASSIFICATIONS"),
  );
  const client = listItems(
    pathBlock("/social/products/whatsapp-extractions").split("- name: status")[0],
    "enum",
  );
  assert.deepEqual(server, ["product", "not_product"]);
  assert.deepEqual([...client].sort(), [...server].sort());
});

test("the status values the app sends are the ones the server accepts", () => {
  const server = literals(
    captured(
      serverPolicy,
      /const PRODUCT_EXTRACTION_LIST_STATUSES = \[([^\]]*)\]/,
      "server PRODUCT_EXTRACTION_LIST_STATUSES",
    ),
  );
  const statusParam = pathBlock("/social/products/whatsapp-extractions")
    .split("- name: status")[1]
    .split("- name:")[0];
  const client = listItems(statusParam, "enum");
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
  const statusParam = pathBlock("/social/products/whatsapp-extractions")
    .split("- name: status")[1]
    .split("- name:")[0];
  const clientStatuses = listItems(statusParam, "enum");
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
  assert.ok(
    listItems(schemaBlock("ProductExtractionQueueCounts"), "required").includes("noText"),
    "the contract's queue counters must include noText",
  );
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
