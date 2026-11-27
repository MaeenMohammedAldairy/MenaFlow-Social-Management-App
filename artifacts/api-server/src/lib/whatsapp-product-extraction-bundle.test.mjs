/**
 * Isolated extraction-worker test. Nothing here imports the live database:
 * drizzle operators and @workspace/db are replaced with an in-memory store, so
 * the worker's bundle → suggestion behaviour is exercised, not merely inferred.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";

const drizzle = await import("drizzle-orm");
const {
  and, eq, inArray, isNotNull, lt, lte, ne, notExists, or, sql, asc, desc,
} = drizzle;

const truePredicate = () => true;
const column = (name) => name;
const operators = {
  ...drizzle,
  eq: (field, value) => (row) => row[field] === value,
  and: (...predicates) => (row) => predicates.every((predicate) => !predicate || predicate(row)),
  or: (...predicates) => (row) => predicates.some((predicate) => predicate && predicate(row)),
  inArray: (field, values) => (row) => values.includes(row[field]),
  ne: (field, value) => (row) => row[field] !== value,
  lt: (field, value) => (row) => row[field] != null && row[field] < value,
  lte: (field, value) => (row) => row[field] != null && row[field] <= value,
  gt: (field, value) => (row) => row[field] != null && row[field] > value,
  gte: (field, value) => (row) => row[field] != null && row[field] >= value,
  isNotNull: () => truePredicate,
  notExists: () => truePredicate,
  sql: () => truePredicate,
  asc: () => truePredicate,
  desc: () => truePredicate,
};
mock.module("drizzle-orm", { namedExports: operators });

const store = new Map();
const tableNames = [
  "menaWhatsAppGroupSelections", "menaWhatsAppGroups", "menaWhatsAppMessageMedia",
  "menaWhatsAppMessages", "menaProductExtractionEvents", "menaProductMatchCandidates",
  "productExtractionSources", "productExtractionSuggestions", "products",
  "whatsappProductExtractionJobs", "workspaces", "menaWhatsAppContentAssociations",
];
const table = (name) => new Proxy({ __tableName: name }, {
  get: (target, property) => property === "__tableName"
    ? name
    : typeof property === "string"
      ? column(property)
      : Reflect.get(target, property),
});
const tables = Object.fromEntries(tableNames.map((name) => [name, table(name)]));
const rowsFor = (name) => {
  if (!store.has(name)) store.set(name, []);
  return store.get(name);
};

class Query {
  constructor(name) { this.name = name; this.predicate = truePredicate; }
  from(source) { this.name = source.__tableName; return this; }
  where(predicate) { this.predicate = predicate; return this; }
  orderBy() { return this; }
  limit(count) { this.max = count; return this; }
  for() { return this; }
  then(resolve, reject) {
    const rows = rowsFor(this.name).filter((row) => this.predicate(row));
    return Promise.resolve(this.max ? rows.slice(0, this.max) : rows).then(resolve, reject);
  }
}
const db = {
  select: () => new Query(""),
  insert: (source) => ({
    values: (values) => {
      let inserted = false;
      const write = () => {
        if (inserted) return;
        inserted = true;
        const now = new Date();
        for (const value of Array.isArray(values) ? values : [values]) {
          rowsFor(source.__tableName).push({
            createdAt: now,
            updatedAt: now,
            ...value,
          });
        }
      };
      const builder = {
        onConflictDoNothing() { write(); return builder; },
        returning() { write(); return Promise.resolve([]); },
        then(resolve, reject) { write(); return Promise.resolve([]).then(resolve, reject); },
      };
      return builder;
    },
  }),
  update: (source) => ({
    set: (changes) => ({
      where: (predicate) => {
        const apply = () => {
          const touched = [];
          for (const row of rowsFor(source.__tableName)) {
            if (predicate(row)) {
              Object.assign(row, changes);
              touched.push({ ...row });
            }
          }
          return touched;
        };
        const result = Promise.resolve(apply());
        // `updateJob` counts its writes through `returning`, so the fake has to
        // answer the same way or a caller looks broken when it is not.
        result.returning = () => Promise.resolve(apply());
        return result;
      },
    }),
  }),
  transaction: (fn) => fn(db),
  execute: () => Promise.resolve(),
};
mock.module("@workspace/db", {
  namedExports: { db, ...tables },
});

const extraction = await import("./product-extraction.ts");
const { emptyProductFacts } = await import("./product-facts.ts");
mock.module("./product-extraction.ts", {
  namedExports: {
    ...extraction,
    // The extractor's contract after the simplification: ONE reading of the
    // whole group. One candidate carrying every message of the group, the facts
    // with their quotes, the prompt version, and the raw response to persist.
    extractWhatsAppProductCandidates: async (_workspaceId, sources) => {
      if (globalThis.__rejectExtraction) {
        // The shape the real extractor throws: the classification in `message`,
        // the refused answers beside it.
        throw Object.assign(new Error("PRODUCT_EXTRACTION_INVALID_RESPONSE"), {
          rejectedResponses: ['{"products": tru}', "ليس JSON"],
        });
      }
      const candidate = (group, name) => ({
        classification: "product",
        sourceMessageIds: group.map((source) => source.id),
        data: {
          name,
          description: "ساعة يد",
          price: "25000",
          currency: "SAR",
          availability: "in_stock",
          sku: null,
          aliases: [],
          priceStatus: "confirmed",
          rawPriceText: "25,000 ريال",
        },
        evidence: { name, price: "25,000 ريال", currency: "ريال" },
        facts: {
          ...emptyProductFacts(),
          features: [{
            value: "مقاومة للماء",
            sourceId: group[0].id,
            quote: name,
            start: 0,
            end: name.length,
            verified: true,
          }],
        },
        confidence: { name: 0.95, price: 0.9, currency: 0.9 },
        complete: true,
      });
      // A group may answer with more than one product (the three-photo album
      // that is genuinely three offers), and then each item has to be linked to
      // its own predecessor rather than to one shared row.
      const candidates = globalThis.__twoCandidates
        ? [
            candidate(sources.slice(0, 2), "ساعة NAVIFORCE"),
            candidate(sources.slice(2), "ساعة كاسيو"),
          ]
        : [candidate(sources, "ساعة NAVIFORCE")];
      return {
        model: "test-model",
        promptVersion: "v3",
        rawResponse: JSON.stringify({ candidates: [{ ok: true }] }),
        candidates,
        nonProductMessageIds: [],
      };
    },
  },
});
mock.module("./product-intake-service.ts", {
  namedExports: { recordExtractionEvent: async () => {} },
});
mock.module("./whatsapp-media-reset.ts", {
  namedExports: { resetFailedWhatsAppMedia: async () => 0 },
});
mock.module("./product-vision-extraction.ts", {
  namedExports: {
    visionProductExtractionEnabled: () => false,
    extractProductCandidatesFromImages: async () => null,
    prepareVisionImage: async () => null,
    readStoredVisionMedia: async () => null,
    selectVisionMedia: () => [],
  },
});
mock.module("./logger.ts", {
  namedExports: {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  },
});

const { processProductExtractionJob, requeueWhatsAppProductMessage } =
  await import("./whatsapp-product-extraction.ts");
const { reopenWhatsAppProductExtractionGroup } =
  await import("./whatsapp-product-group-reopen.ts");
const { autoAcceptWhatsAppSuggestions, whatsappProductBundleId } =
  await import("./whatsapp-content-associations.ts");

function seedLateBundle() {
  seed();
  const oldId = "old-single-source";
  rowsFor("productExtractionSuggestions").push({
    id: oldId,
    ownerId: "owner",
    workspaceId,
    sourceKey: extraction.productExtractionSourceKey(["name"]),
    version: 1,
    // The default `ALTER TABLE … ADD COLUMN item_index … DEFAULT 1` gives every
    // pre-existing row, so a legacy suggestion is item 1 of its group.
    itemIndex: 1,
    status: "review",
    productId: null,
  });
  rowsFor("productExtractionSources").push({
    workspaceId,
    suggestionId: oldId,
    messageId: "name",
    itemIndex: 1,
  });
  job().status = "complete";
  job().rulesetVersion = "v1";
}

const workspaceId = "workspace-a";
const ids = ["name", "price", "color", "image"];
const bundleId = "bundle-test";

function seed() {
  for (const rows of store.values()) rows.length = 0;
  rowsFor("workspaces").push({ id: workspaceId, country: "SA" });
  rowsFor("menaWhatsAppGroups").push({
    id: "group-a", workspaceId, instanceName: "instance-a",
    name: "مجموعة المنتجات", parentGroupId: null,
  });
  rowsFor("menaWhatsAppGroupSelections").push({
    id: "selection-1", workspaceId, instanceName: "instance-a",
    groupId: "group-a", selected: true,
  });
  const base = Date.parse("2026-11-25T10:00:00.000Z");
  const texts = {
    name: "ساعة NAVIFORCE",
    price: "السعر 25,000 ريال",
    color: "متوفرة باللون الأسود والفضي",
    image: null,
  };
  rowsFor("menaWhatsAppMessages").push(...ids.map((id, index) => ({
    id,
    ownerId: "owner",
    workspaceId,
    instanceName: "instance-a",
    groupId: "group-a",
    groupJid: "120363012345678901@g.us",
    remoteMessageId: `remote-${id}`,
    senderId: "sender-a",
    fromMe: false,
    messageType: "conversation",
    textBody: texts[id],
    caption: null,
    mediaAvailable: false,
    mediaDownloadStatus: "not_required",
    messageStatus: "received",
    messageTimestamp: new Date(base + index * 1000),
    createdAt: new Date(base + index * 1000),
    replyToRemoteId: null,
    mediaGroupId: null,
    mediaGroupSource: null,
  })));
  for (const [index, id] of ids.entries()) {
    if (id === "name") continue;
    rowsFor("menaWhatsAppContentAssociations").push({
      id: `edge-${id}`,
      workspaceId,
      instanceName: "instance-a",
      groupId: "group-a",
      leftMessageId: "name",
      rightMessageId: id,
      decision: "accepted",
      contentBundleId: bundleId,
      createdAt: new Date(base + index * 1000),
    });
  }
  rowsFor("whatsappProductExtractionJobs").push({
    id: "job-1",
    ownerId: "owner",
    workspaceId,
    messageId: "name",
    status: "pending",
    stage: "received",
    attempts: 1,
    rulesetVersion: "v1",
    idempotencyKey: null,
    nextRunAt: new Date(base - 1000),
    createdAt: new Date(base - 1000),
    updatedAt: new Date(base - 1000),
  });
}

const job = () => rowsFor("whatsappProductExtractionJobs")[0];
const suggestions = () => rowsFor("productExtractionSuggestions");
const sources = () => rowsFor("productExtractionSources");

test("worker persists one four-source suggestion for a confirmed bundle", async () => {
  seed();
  await processProductExtractionJob(job());
  assert.equal(suggestions().length, 1);
  assert.equal(sources().length, 4);
  assert.deepEqual(sources().map((row) => row.messageId).sort(), [...ids].sort());
  assert.equal(suggestions()[0].version, 1);
  assert.equal(suggestions()[0].sourceKey,
    extraction.productExtractionSourceKey(ids));
  assert.equal(suggestions()[0].status, "review");
  assert.equal(job().status, "complete");
  assert.equal(rowsFor("products").length, 0);
  // What the run read, and from which prompt: the review screen shows the media
  // state and the reason codes instead of guessing.
  const row = suggestions()[0];
  assert.equal(row.promptVersion, "v3");
  assert.equal(row.itemIndex, 1);
  assert.equal(row.mediaState, "not_applicable");
  assert.equal(row.extractedData.features.length, 1);
  assert.equal(row.extractedData.fact_counts.features, 1);
  // The key names what was read as one offer: an accepted bundle, an album, or
  // the single message when neither exists.
  assert.ok(row.groupKey && /^(bundle|album|message):[0-9a-f]{32}$/.test(row.groupKey));
  assert.ok(row.groupKey.startsWith("bundle:"));
  assert.equal(job().reasonCode, "RECORDED");
});

test("worker replay of the same job creates no second suggestion", async () => {
  seed();
  await processProductExtractionJob(job());
  await processProductExtractionJob(job());
  assert.equal(suggestions().length, 1);
  assert.equal(sources().length, 4);
});

test("reprocessing a bundle keeps the old suggestion and links a new version", async () => {
  seed();
  await processProductExtractionJob(job());
  const firstId = suggestions()[0].id;
  job().rulesetVersion = "v2";
  job().status = "pending";
  await processProductExtractionJob(job());
  assert.equal(suggestions().length, 2);
  assert.equal(suggestions().find((row) => row.id === firstId).status, "superseded");
  const latest = suggestions().find((row) => row.id !== firstId);
  assert.equal(latest.version, 2);
  assert.equal(latest.previousSuggestionId, firstId);
  // The chain belongs to the group, not to the message that happened to be
  // first: a re-run of the same group lands on the same key.
  assert.equal(latest.groupKey, suggestions().find((r) => r.id === firstId).groupKey);
  assert.equal(latest.sourceKey, extraction.productExtractionSourceKey(ids));
  assert.equal(sources().filter((row) => row.suggestionId === latest.id).length, 4);
  await processProductExtractionJob(job());
  assert.equal(suggestions().length, 2);
});

test("a suggestion that already created a product is never silently merged", async () => {
  seed();
  await processProductExtractionJob(job());
  suggestions()[0].status = "draft_created";
  suggestions()[0].productId = "existing-product";
  const firstId = suggestions()[0].id;
  rowsFor("products").push({
    id: "existing-product", workspaceId, name: "ساعة NAVIFORCE",
    normalizedName: "ساعه naviforce", sku: "MF-TEST", aliases: [],
  });
  job().rulesetVersion = "v2";
  job().status = "pending";
  await processProductExtractionJob(job());
  // No second catalog row, and the accepted suggestion keeps the link it has:
  // a draft the merchant published is not ours to re-cut from behind.
  assert.equal(rowsFor("products").length, 1);
  const latest = suggestions().reduce((best, row) =>
    row.version > best.version ? row : best);
  assert.equal(latest.version, 2);
  assert.equal(latest.previousSuggestionId, firstId);
  assert.equal(latest.productId, null);
  assert.ok(["review", "possible_duplicate"].includes(latest.status));
  const accepted = suggestions().find((row) => row.id === firstId);
  assert.equal(accepted.status, "draft_created");
  assert.equal(accepted.productId, "existing-product");
});

test("a late accepted bundle reprocesses a single-source review suggestion as a new version", async () => {
  seedLateBundle();
  await requeueWhatsAppProductMessage(workspaceId, "name");
  assert.equal(job().rulesetVersion, "v2");
  assert.equal(job().status, "pending");
  await processProductExtractionJob(job());
  assert.equal(suggestions().length, 2);
  assert.equal(suggestions()[0].status, "superseded");
  const latest = suggestions()[1];
  assert.equal(latest.version, 2);
  assert.equal(latest.previousSuggestionId, "old-single-source");
  assert.equal(sources().filter((row) => row.suggestionId === latest.id).length, 4);
});

test("auto-accept links all four messages into one deterministic bundle and is replay-safe", async () => {
  seed();
  rowsFor("menaWhatsAppContentAssociations").length = 0;
  const messages = rowsFor("menaWhatsAppMessages").map((row) => ({
    id: row.id,
    remoteMessageId: row.remoteMessageId,
    senderId: row.senderId,
    textBody: row.textBody,
    caption: row.caption,
    mediaAvailable: row.mediaAvailable,
    mediaGroupId: row.mediaGroupId,
    mediaGroupSource: row.mediaGroupSource,
    messageTimestamp: row.messageTimestamp.toISOString(),
    createdAt: row.createdAt.toISOString(),
    replyToRemoteId: row.replyToRemoteId,
    mediaCount: row.id === "image" ? 1 : 0,
    workspaceId,
    instanceName: row.instanceName,
    groupId: row.groupId,
    groupJid: row.groupJid,
  }));
  const input = { workspaceId, instanceName: "instance-a", groupId: "group-a", messages };
  const first = await autoAcceptWhatsAppSuggestions(input);
  assert.equal(first.acceptedCount, 3);
  assert.deepEqual([...first.messageIds].sort(), [...ids].sort());
  const edges = rowsFor("menaWhatsAppContentAssociations");
  assert.equal(edges.length, 3);
  assert.equal(new Set(edges.map((edge) => edge.contentBundleId)).size, 1);
  // New bundles get a deterministic id from their first accepted pair; later
  // members reuse it so existing links are never rewritten.
  assert.equal(edges[0].contentBundleId, whatsappProductBundleId(input,
    [edges[0].leftMessageId, edges[0].rightMessageId]));
  const replay = await autoAcceptWhatsAppSuggestions(input);
  assert.equal(replay.acceptedCount, 0);
  assert.equal(rowsFor("menaWhatsAppContentAssociations").length, 3);
});

test("auto-accept never links messages from a different workspace", async () => {
  seed();
  rowsFor("menaWhatsAppContentAssociations").length = 0;
  const base = rowsFor("menaWhatsAppMessages")[0];
  const toSuggestion = (row) => ({
    ...row,
    messageTimestamp: row.messageTimestamp.toISOString(),
    createdAt: row.createdAt.toISOString(),
    mediaCount: 0,
  });
  await autoAcceptWhatsAppSuggestions({
    workspaceId, instanceName: "instance-a", groupId: "group-a",
    messages: [
      toSuggestion(base),
      { ...toSuggestion(base), id: "other-workspace", workspaceId: "workspace-b" },
    ],
  });
  assert.equal(rowsFor("menaWhatsAppContentAssociations").length, 0);
});

test("a group already read together is not paid for twice", async () => {
  seed();
  await processProductExtractionJob(job());
  // The four messages have been read as one group at this version.
  const first = await reopenWhatsAppProductExtractionGroup({
    workspaceId,
    messageIds: [...ids],
    reason: "association_accepted",
  });
  assert.equal(first.reopened, 0, "nothing joined the group, so nothing is reopened");
  assert.equal(first.created, 0);
  // The message that has never been read with its group is a different case:
  // the caption is what the reading was missing, and re-running costs a call
  // that can actually answer.
  const grown = await reopenWhatsAppProductExtractionGroup({
    workspaceId,
    messageIds: [...ids, "caption-late"],
    reason: "bundle_grown",
  });
  assert.ok(grown.reopened + grown.created > 0, "a grown group is re-armed");
  assert.match(grown.rulesetVersion, /^v\d+$/);
});

test("a rejected answer is kept, not just counted", async () => {
  // «الاستخراج سيء» used to be the whole record of a failure, and the answer
  // that was refused vanished with it. The rejection has to reach the job row,
  // through the worker — not through a new state the queue has to reason about.
  seed();
  globalThis.__rejectExtraction = true;
  let thrown;
  try {
    await processProductExtractionJob(job());
  } catch (error) {
    thrown = error;
  } finally {
    delete globalThis.__rejectExtraction;
  }
  // The failure is still the queue's to classify — the extraction path adds the
  // evidence without taking the decision.
  assert.equal(thrown?.message, "PRODUCT_EXTRACTION_INVALID_RESPONSE");
  assert.equal(job().rawExtractionResponse.rejected.length, 2);
  assert.deepEqual(job().rawExtractionResponse, {
    rejected: ['{"products": tru}', "ليس JSON"],
  });
});

test("each item of a multi-product group links to its own predecessor", async () => {
  // `mena_product_extraction_version_key` is unique on
  // (workspace, previous_suggestion_id, version). If every item of a re-read
  // group names the same predecessor row, the second insert of that version
  // collides with the first — and a version that cannot be written is a
  // re-extraction that silently stores nothing.
  seedLateBundle();
  globalThis.__twoCandidates = true;
  await requeueWhatsAppProductMessage(workspaceId, "name");
  await processProductExtractionJob(job());
  delete globalThis.__twoCandidates;
  const versions = suggestions().filter((row) => row.version === 2);
  assert.equal(versions.length, 2, "one group, two products, two items");
  assert.deepEqual(
    versions.map((row) => row.itemIndex).sort(),
    [1, 2],
  );
  // The first item replaces the one review row that existed; the second is new
  // to this group, so it chains to nothing instead of stealing the link.
  assert.deepEqual(
    versions
      .map((row) => row.previousSuggestionId)
      .sort(),
    [null, "old-single-source"],
  );
});
