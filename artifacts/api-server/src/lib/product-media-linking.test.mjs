/**
 * Isolated end-to-end check for WhatsApp source media → product media refs →
 * catalog previews. The live DB is never contacted; an in-memory drizzle-like
 * store is injected through module mocks.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";

const drizzle = await import("drizzle-orm");
const truePredicate = () => true;
const mockOperators = {
  ...drizzle,
  eq: (field, value) => (row) => row[field] === value,
  and: (...predicates) => (row) => predicates.every((p) => !p || p(row)),
  or: (...predicates) => (row) => predicates.some((p) => p && p(row)),
  inArray: (field, values) => (row) => values.includes(row[field]),
  ne: (field, value) => (row) => row[field] !== value,
  lt: (field, value) => (row) => row[field] != null && row[field] < value,
  lte: (field, value) => (row) => row[field] != null && row[field] <= value,
  gt: (field, value) => (row) => row[field] != null && row[field] > value,
  gte: (field, value) => (row) => row[field] != null && row[field] >= value,
  isNotNull: (field) => (row) => row[field] != null,
  notExists: () => truePredicate,
  sql: () => truePredicate,
  asc: () => truePredicate,
  desc: () => truePredicate,
};
mock.module("drizzle-orm", { namedExports: mockOperators });

const tableNames = [
  "menaWhatsAppGroupSelections", "menaWhatsAppGroups", "menaWhatsAppMessageMedia",
  "menaWhatsAppMessages", "menaProductExtractionEvents", "menaProductMatchCandidates",
  "productExtractionSources", "productExtractionSuggestions", "products",
  "whatsappProductExtractionJobs", "workspaces", "menaWhatsAppContentAssociations",
  "menaInventoryMovements",
];
const table = (name) => new Proxy({ __tableName: name }, {
  get: (target, property) => property === "__tableName"
    ? name
    : typeof property === "string" ? property : Reflect.get(target, property),
});
const tables = Object.fromEntries(tableNames.map((name) => [name, table(name)]));
const store = new Map();
const rowsFor = (name) => {
  if (!store.has(name)) store.set(name, []);
  return store.get(name);
};

function mergeJoined(baseRow, joinName, joinedRows) {
  const message = joinName === "menaWhatsAppMessages"
    ? joinedRows.find((row) => row.id === baseRow.messageId)
    : null;
  if (!message) return null;
  return {
    ...baseRow,
    mediaId: baseRow.id,
    messageId: baseRow.messageId,
    mediaWorkspaceId: baseRow.workspaceId,
    messageWorkspaceId: message.workspaceId,
    groupId: message.groupId,
    groupJid: message.groupJid,
    downloadStatus: baseRow.downloadStatus,
    messageTimestamp: message.messageTimestamp,
    messageCreatedAt: message.createdAt,
    mediaIndex: baseRow.mediaIndex,
    mediaCreatedAt: baseRow.createdAt,
  };
}

class Query {
  constructor(fields) {
    this.fields = fields;
    this.predicate = truePredicate;
    this.joins = [];
  }
  from(source) { this.name = source.__tableName; return this; }
  innerJoin(source) { this.joins.push(source.__tableName); return this; }
  where(predicate) { this.predicate = predicate; return this; }
  orderBy() { return this; }
  limit(count) { this.max = count; return this; }
  for() { return this; }
  then(resolve, reject) {
    let rows = rowsFor(this.name).filter((row) => this.predicate(row));
    for (const joinName of this.joins) {
      rows = rows.flatMap((row) => {
        const merged = mergeJoined(row, joinName, rowsFor(joinName));
        return merged ? [merged] : [];
      });
    }
    if (this.fields) {
      rows = rows.map((row) => Object.fromEntries(
        Object.entries(this.fields).map(([alias, field]) =>
          [alias, alias in row ? row[alias] : row[field]],
        ),
      ));
    }
    const result = this.max ? rows.slice(0, this.max) : rows;
    return Promise.resolve(result).then(resolve, reject);
  }
}
const db = {
  select: (fields) => new Query(fields),
  insert: (source) => ({
    values: (values) => {
      let written = false;
      const write = () => {
        if (written) return;
        written = true;
        const now = new Date();
        for (const value of Array.isArray(values) ? values : [values]) {
          rowsFor(source.__tableName).push({ createdAt: now, updatedAt: now, ...value });
        }
      };
      return {
        onConflictDoNothing() { write(); return this; },
        returning() { write(); return Promise.resolve(rowsFor(source.__tableName).slice(-1)); },
        then(resolve, reject) { write(); return Promise.resolve([]).then(resolve, reject); },
      };
    },
  }),
  update: (source) => ({
    set: (changes) => ({
      where: (predicate) => {
        for (const row of rowsFor(source.__tableName)) {
          if (predicate(row)) Object.assign(row, changes);
        }
        return Promise.resolve([]);
      },
    }),
  }),
  transaction: (fn) => fn(db),
  execute: () => Promise.resolve(),
};
mock.module("@workspace/db", { namedExports: { db, ...tables } });

const extraction = await import("./product-extraction.ts");
const { emptyProductFacts } = await import("./product-facts.ts");
mock.module("./product-extraction.ts", {
  namedExports: {
    ...extraction,
    // One reading of the group: a single candidate that names every message the
    // group covered, which is what lets the product inherit the media of the
    // whole bundle rather than only the photo that happened to carry the text.
    extractWhatsAppProductCandidates: async (_workspaceId, sources) => ({
      model: "test-model",
      promptVersion: "v3",
      rawResponse: "{}",
      candidates: [{
        classification: "product",
        sourceMessageIds: sources.map((source) => source.id),
        data: {
          name: "ساعة NAVIFORCE",
          description: "ساعة يد",
          price: "25000",
          currency: "SAR",
          availability: "in_stock",
          sku: "MF-1",
          aliases: [],
          priceStatus: "confirmed",
          rawPriceText: "25000 ريال",
        },
        evidence: {
          name: "ساعة NAVIFORCE", description: "ساعة يد",
          price: "25000 ريال", currency: "ريال", sku: "MF-1",
        },
        facts: emptyProductFacts(),
        confidence: {
          name: 0.95, description: 0.95, price: 0.95, currency: 0.95,
          availability: 0.95, sku: 0.95,
        },
        complete: true,
      }],
      nonProductMessageIds: [],
    }),
  },
});
mock.module("./product-intake-service.ts", {
  namedExports: { recordExtractionEvent: async () => {} },
});
mock.module("./product-vision-extraction.ts", {
  namedExports: {
    visionProductExtractionEnabled: () => false,
    prepareVisionImage: async () => null,
    readStoredVisionMedia: async () => null,
    selectVisionMedia: () => [],
  },
});
mock.module("./whatsapp-media-reset.ts", {
  namedExports: { resetFailedWhatsAppMedia: async () => 0 },
});
const publicMediaExports = {
  PublicMediaUrlError: class extends Error {},
  signedWhatsAppMediaUrl: (id) => `https://media.example.test/whatsapp/${id}`,
  signedProductMediaUrl: (id) => `https://media.example.test/product/${id}`,
  verifySignedMediaRequest: () => true,
  metaTokenEncryptionKey: () => "test-key",
  resolvePublicMediaBaseUrl: () => "https://media.example.test",
};
mock.module("./public-media-url.ts", { namedExports: publicMediaExports });
mock.module("./logger.ts", {
  namedExports: { logger: { info() {}, warn() {}, error() {}, debug() {} } },
});

const { resolveWhatsAppSourceMediaIds } = await import("./product-source-media.ts");
const { catalogProductResponse, productMediaPreviews } =
  await import("../routes/product-route-helpers.ts");
const { processProductExtractionJob } = await import("./whatsapp-product-extraction.ts");

const workspaceId = "workspace-a";
const otherWorkspace = "workspace-b";
const baseTime = Date.parse("2026-11-25T10:00:00.000Z");

function seed({ fromMe = true } = {}) {
  for (const rows of store.values()) rows.length = 0;
  rowsFor("workspaces").push({ id: workspaceId, country: null });
  rowsFor("menaWhatsAppGroups").push({
    id: "group-a", workspaceId, instanceName: "instance-a",
    name: "مجموعة", parentGroupId: null,
  });
  rowsFor("menaWhatsAppGroupSelections").push({
    id: "selection-1", workspaceId, instanceName: "instance-a",
    groupId: "group-a", selected: true,
  });
  const ids = ["name", "price", "color", "image"];
  rowsFor("menaWhatsAppMessages").push(...ids.map((id, index) => ({
    id,
    ownerId: "owner",
    workspaceId,
    instanceName: "instance-a",
    groupId: "group-a",
    groupJid: "120363012345678901@g.us",
    remoteMessageId: `remote-${id}`,
    senderId: fromMe ? null : "sender-a",
    fromMe,
    messageType: "conversation",
    textBody: index === 0 ? "ساعة NAVIFORCE" : index === 1 ? "السعر 25000 ريال" : null,
    caption: null,
    mediaAvailable: id === "image",
    mediaDownloadStatus: id === "image" ? "stored" : "not_required",
    messageStatus: "received",
    messageTimestamp: new Date(baseTime + index * 1000),
    createdAt: new Date(baseTime + index * 1000),
    replyToRemoteId: null,
    mediaGroupId: null,
    mediaGroupSource: null,
  })));
  const media = [
    { id: "media-color", messageId: "color", mediaIndex: 1, downloadStatus: "stored", mediaType: "image" },
    { id: "media-price", messageId: "price", mediaIndex: 0, downloadStatus: "stored", mediaType: "image" },
    { id: "media-pending", messageId: "image", mediaIndex: 0, downloadStatus: "pending", mediaType: "image" },
    { id: "media-failed", messageId: "name", mediaIndex: 0, downloadStatus: "failed", mediaType: "image" },
    { id: "media-other", messageId: "image", mediaIndex: 1, downloadStatus: "stored", mediaType: "image", workspaceId: otherWorkspace },
  ];
  rowsFor("menaWhatsAppMessageMedia").push(...media.map((item) => ({
    ownerId: "owner",
    workspaceId: workspaceId,
    instanceName: "instance-a",
    groupId: "group-a",
    groupJid: "120363012345678901@g.us",
    storagePath: `whatsapp-media/${item.id}`,
    ...item,
  })));
  rowsFor("menaWhatsAppContentAssociations").push(...ids.slice(1).map((id, index) => ({
    id: `edge-${id}`,
    workspaceId,
    instanceName: "instance-a",
    groupId: "group-a",
    leftMessageId: "name",
    rightMessageId: id,
    decision: "accepted",
    contentBundleId: "bundle-1",
    createdAt: new Date(baseTime + index * 1000),
  })));
  rowsFor("whatsappProductExtractionJobs").push({
    id: "job-1", ownerId: "owner", workspaceId, messageId: "name",
    status: "pending", stage: "received", attempts: 1,
    rulesetVersion: "v1", idempotencyKey: null,
    nextRunAt: new Date(baseTime - 1000),
    createdAt: new Date(baseTime - 1000),
    updatedAt: new Date(baseTime - 1000),
  });
}

test("resolver links only stored, in-scope group media in original order", async () => {
  seed();
  assert.deepEqual(
    await resolveWhatsAppSourceMediaIds({
      workspaceId,
      messageIds: ["image", "color", "price", "name"],
    }),
    ["media-price", "media-color"],
  );
});

test("resolver reads the persisted suggestion sources and deduplicates ids", async () => {
  seed();
  rowsFor("productExtractionSuggestions").push({
    id: "suggestion-1", workspaceId, status: "review", productId: null,
  });
  rowsFor("productExtractionSources").push(
    { workspaceId, suggestionId: "suggestion-1", messageId: "color", itemIndex: 1 },
    { workspaceId, suggestionId: "suggestion-1", messageId: "price", itemIndex: 1 },
  );
  assert.deepEqual(
    await resolveWhatsAppSourceMediaIds({ workspaceId, suggestionId: "suggestion-1" }),
    ["media-price", "media-color"],
  );
});

test("worker auto-create persists the same media references", async () => {
  seed();
  await processProductExtractionJob(rowsFor("whatsappProductExtractionJobs")[0]);
  const created = rowsFor("products");
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].mediaUrls, ["media-price", "media-color"]);
  const suggestion = rowsFor("productExtractionSuggestions")[0];
  assert.equal(suggestion.status, "draft_created");
  assert.equal(suggestion.productId, created[0].id);
});

test("catalog API turns stored WhatsApp refs into viewable image previews", async () => {
  seed();
  const product = {
    id: "product-1",
    workspaceId,
    name: "ساعة",
    description: "وصف",
    price: "25000",
    currency: "SAR",
    availability: "in_stock",
    mediaUrls: ["media-price", "media-color", "media-pending", "media-failed", "media-other"],
  };
  const response = await catalogProductResponse(product, workspaceId, [], "https://app.example.test");
  assert.deepEqual(response.mediaUrls, [
    "media-price", "media-color", "media-pending", "media-failed", "media-other",
  ]);
  assert.deepEqual(response.mediaPreviews.map((preview) => preview.id),
    ["media-price", "media-color"]);
  assert.deepEqual(response.mediaPreviews.map((preview) => preview.url), [
    "https://media.example.test/whatsapp/media-price",
    "https://media.example.test/whatsapp/media-color",
  ]);
  assert.deepEqual(await productMediaPreviews(workspaceId, ["media-other"], undefined), []);
});
