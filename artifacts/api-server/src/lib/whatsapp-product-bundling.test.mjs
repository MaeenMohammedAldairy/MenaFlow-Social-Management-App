import assert from "node:assert/strict";
import test from "node:test";
import {
  findWhatsAppProductBundleSuggestions,
  selectAutoAcceptableProductBundleSuggestions,
  WHATSAPP_BUNDLE_REASON,
} from "./whatsapp-association-suggestions.ts";
import { whatsappProductBundleId } from "./whatsapp-content-association-logic.ts";
import { collapseProductCandidatesForBundle, productExtractionSourceKey } from "./product-extraction.ts";

const baseTime = Date.parse("2026-11-25T10:00:00.000Z");
const scope = {
  workspaceId: "workspace-a",
  instanceName: "instance-a",
  groupId: "group-a",
  groupJid: "120363012345678901@g.us",
};

function message(overrides = {}) {
  const time = baseTime + (overrides.offset ?? 0);
  return {
    id: overrides.id ?? `message-${overrides.offset ?? 0}`,
    remoteMessageId: overrides.remoteMessageId ?? `remote-${overrides.id ?? overrides.offset ?? 0}`,
    senderId: overrides.senderId ?? "sender-a",
    textBody: overrides.textBody ?? null,
    caption: overrides.caption ?? null,
    mediaAvailable: overrides.mediaAvailable ?? false,
    mediaGroupId: overrides.mediaGroupId ?? null,
    mediaGroupSource: overrides.mediaGroupSource ?? null,
    messageTimestamp: new Date(time).toISOString(),
    createdAt: new Date(time + 5_000).toISOString(),
    replyToRemoteId: overrides.replyToRemoteId ?? null,
    mediaCount: overrides.mediaCount ?? 0,
    ...scope,
    ...overrides.scope,
  };
}

function acceptedEdges(messages) {
  const suggestions = findWhatsAppProductBundleSuggestions(messages);
  return selectAutoAcceptableProductBundleSuggestions(suggestions);
}

function components(messages, edges = acceptedEdges(messages)) {
  const parent = new Map(messages.map((item) => [item.id, item.id]));
  const find = (id) => {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)));
    return parent.get(id);
  };
  for (const edge of edges) {
    const left = find(edge.sourceMessageId);
    const right = find(edge.candidateMessageId);
    if (left && right) parent.set(right, left);
  }
  const groups = new Map();
  for (const id of parent.keys()) {
    const root = find(id);
    groups.set(root, [...(groups.get(root) ?? []), id]);
  }
  return [...groups.values()].map((ids) => new Set(ids));
}

const singleSource = (candidate, extra = {}) => ({
  classification: "product",
  sourceMessageIds: [candidate.sourceMessageId ?? "a"],
  data: {
    name: "ساعة NAVIFORCE", sku: null, aliases: [], description: "وصف",
    price: "25000", currency: "SAR", availability: "in_stock",
  },
  evidence: { name: "ساعة NAVIFORCE", price: "25000 ريال" },
  confidence: { name: 0.95, price: 0.9 },
  complete: true,
  ...extra,
});

test("1 - name, price, colour and image form one bundle and one multi-source candidate", () => {
  const messages = [
    message({ id: "name", offset: 0, textBody: "ساعة NAVIFORCE" }),
    message({ id: "price", offset: 1000, textBody: "السعر 25,000 ريال" }),
    message({ id: "color", offset: 2000, textBody: "متوفرة باللون الأسود والفضي" }),
    message({ id: "image", offset: 3000, mediaAvailable: true, mediaCount: 1 }),
  ];
  const edges = acceptedEdges(messages);
  const bundle = components(messages, edges).find((set) => set.size === 4);
  assert.ok(bundle, `expected a four-message bundle, got ${JSON.stringify(edges)}`);
  assert.deepEqual([...bundle].sort(), ["color", "image", "name", "price"]);
  assert.ok(edges.every((edge) =>
    edge.reason !== WHATSAPP_BUNDLE_REASON.ambiguousMedia));

  const sources = [...bundle];
  const collapsed = collapseProductCandidatesForBundle(
    messages.map((item) => singleSource({ sourceMessageId: item.id }, {
      data: {
        name: item.id === "name" ? "ساعة NAVIFORCE" : null,
        price: item.id === "price" ? "25000" : null,
        currency: item.id === "price" ? "SAR" : null,
        aliases: [], sku: null, description: null, availability: null,
      },
    })),
    sources,
  );
  assert.equal(collapsed.candidates.length, 1);
  assert.equal(collapsed.candidates[0].sourceMessageIds.length, 4);
  assert.equal(collapsed.mixedBundle, false);
});

test("2 - two different products produce two independent bundles and two suggestions", () => {
  const messages = [
    message({ id: "watch-name", offset: 0, textBody: "ساعة NAVIFORCE" }),
    message({ id: "watch-price", offset: 1000, textBody: "السعر 25,000 ريال" }),
    message({ id: "watch-image", offset: 2000, mediaAvailable: true, mediaCount: 1 }),
    message({ id: "shoe-name", offset: 3000, textBody: "حذاء رياضي رجالي" }),
    message({ id: "shoe-price", offset: 4000, textBody: "السعر 15,000 ريال" }),
    message({ id: "shoe-image", offset: 5000, mediaAvailable: true, mediaCount: 1 }),
  ];
  const bundles = components(messages).filter((set) => set.size > 1);
  assert.equal(bundles.length, 2);
  assert.ok(bundles.some((set) => ["watch-name", "watch-price", "watch-image"]
    .every((id) => set.has(id))));
  assert.ok(bundles.some((set) => ["shoe-name", "shoe-price", "shoe-image"]
    .every((id) => set.has(id))));
  assert.ok(!bundles.some((set) => set.has("watch-name") && set.has("shoe-name")));
});

test("3 - a late-arriving name joins an earlier image and price by original order", () => {
  const messages = [
    // Arrival order is reversed; original timestamps stay intact.
    message({ id: "name", offset: 2000, createdAt: new Date(baseTime + 9_000).toISOString(), textBody: "ساعة NAVIFORCE" }),
    message({ id: "price", offset: 1000, createdAt: new Date(baseTime + 8_000).toISOString(), textBody: "السعر 25,000 ريال" }),
    message({ id: "image", offset: 0, createdAt: new Date(baseTime + 7_000).toISOString(), mediaAvailable: true, mediaCount: 1 }),
  ];
  const bundle = components(messages).find((set) => set.size === 3);
  assert.ok(bundle, JSON.stringify(acceptedEdges(messages)));
  assert.deepEqual([...bundle].sort(), ["image", "name", "price"]);
});

test("4 - a reply reference links to the original product message", () => {
  const anchor = message({ id: "anchor", offset: 0, textBody: "ساعة NAVIFORCE" });
  const reply = message({
    id: "reply", offset: 90_000, textBody: "وهذا السعر", replyToRemoteId: anchor.remoteMessageId,
  });
  const edges = acceptedEdges([anchor, reply]);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].reason, WHATSAPP_BUNDLE_REASON.reply);
  assert.deepEqual([...components([anchor, reply], edges)[0]].sort(), ["anchor", "reply"]);
});

test("5 - same sender and adjacent time never merges two different products", () => {
  const messages = [
    message({ id: "watch", offset: 0, textBody: "ساعة NAVIFORCE" }),
    message({ id: "shoe", offset: 100, textBody: "حذاء رياضي رجالي" }),
  ];
  assert.equal(acceptedEdges(messages).length, 0);
  assert.equal(components(messages).filter((set) => set.size > 1).length, 0);
  assert.equal(whatsappProductBundleId(scope, ["shoe", "watch"]),
    whatsappProductBundleId(scope, ["watch", "shoe"]));
});

test("6 - similar names in two groups are never linked", () => {
  const first = [0, 1000].map((offset, index) => message({
    id: `group-a-${index}`, offset, textBody: "ساعة NAVIFORCE",
  }));
  const second = [200, 1200].map((offset, index) => message({
    id: `group-b-${index}`, offset, textBody: "ساعة NAVIFORCE",
    scope: { ...scope, groupId: "group-b", instanceName: "instance-b" },
  }));
  const edges = acceptedEdges([...first, ...second]);
  assert.ok(edges.every((edge) => {
    const left = [...first, ...second].find((item) => item.id === edge.sourceMessageId);
    const right = [...first, ...second].find((item) => item.id === edge.candidateMessageId);
    return left.groupId === right.groupId && left.instanceName === right.instanceName;
  }), JSON.stringify(edges));
  assert.equal(components([...first, ...second]).some((set) =>
    set.has("group-a-0") && set.has("group-b-0")), false);
});

test("7 - the same group JID in two workspaces is never linked", () => {
  const first = message({ id: "a", offset: 0, textBody: "ساعة NAVIFORCE" });
  const second = message({
    id: "b", offset: 500, textBody: "ساعة NAVIFORCE",
    scope: { ...scope, workspaceId: "workspace-b" },
  });
  assert.equal(acceptedEdges([first, second]).length, 0);
});

test("8 - a replayed message cannot create a duplicate bundle", () => {
  const original = message({ id: "name", offset: 0, textBody: "ساعة NAVIFORCE" });
  const replay = { ...original, createdAt: new Date(baseTime + 60_000).toISOString() };
  const edges = acceptedEdges([original, replay]);
  assert.ok(edges.every((edge) =>
    edge.sourceMessageId !== edge.candidateMessageId));
  const bundles = components([original, replay], edges).filter((set) => set.size > 1);
  assert.equal(bundles.length, 0);
});

test("9 - a reprocessed worker replay keeps the same source key and one candidate", () => {
  const ids = ["name", "price", "color", "image"];
  assert.equal(productExtractionSourceKey([...ids].reverse()),
    productExtractionSourceKey(ids));
  const collapsed = collapseProductCandidatesForBundle(
    ids.map((id) => singleSource({ sourceMessageId: id })),
    ids,
  );
  assert.equal(collapsed.candidates.length, 1);
  assert.equal(collapsed.candidates[0].sourceMessageIds.length, 4);
});

test("10 - messages without evidence stay separate", () => {
  const messages = [
    message({ id: "hello", offset: 0, textBody: "مرحبا" }),
    message({ id: "image", offset: 1000, mediaAvailable: true, mediaCount: 1, senderId: "another" }),
  ];
  assert.equal(acceptedEdges(messages).length, 0);
  assert.equal(components(messages).filter((set) => set.size > 1).length, 0);
});

test("11 - a review-era single-source suggestion is preserved beside a new bundle version", () => {
  const previous = singleSource({ sourceMessageId: "old" }, {
    status: "review", version: 1, sourceKey: productExtractionSourceKey(["old"]),
  });
  const current = collapseProductCandidatesForBundle(
    [singleSource({ sourceMessageId: "old" })], ["old", "price"],
  );
  assert.equal(previous.sourceKey, productExtractionSourceKey(["old"]));
  assert.notEqual(previous.sourceKey,
    productExtractionSourceKey(current.candidates[0].sourceMessageIds));
  assert.equal(current.candidates[0].sourceMessageIds.length, 2);
});

test("12 - a bundle whose suggestion already created a product is not auto-merged", () => {
  const conflicting = collapseProductCandidatesForBundle([
    singleSource({ sourceMessageId: "a" }, { data: {
      name: "ساعة NAVIFORCE", sku: null, aliases: [], description: null,
      price: "25000", currency: "SAR", availability: "in_stock",
    } }),
    singleSource({ sourceMessageId: "b" }, { data: {
      name: "حذاء رياضي", sku: null, aliases: [], description: null,
      price: "15000", currency: "SAR", availability: "in_stock",
    } }),
  ], ["a", "b"]);
  assert.equal(conflicting.candidates.length, 1);
  assert.equal(conflicting.mixedBundle, true);
  assert.equal(conflicting.candidates[0].complete, false);
});

test("13 - DM messages are excluded from product bundles", () => {
  const dm = message({ id: "dm", offset: 0, textBody: "ساعة NAVIFORCE", scope: {
    ...scope, instanceName: "dm-instance", groupId: null,
  } });
  const group = message({ id: "group", offset: 1000, textBody: "ساعة NAVIFORCE" });
  assert.equal(acceptedEdges([dm, group]).length, 0);
  assert.equal(components([dm, group]).filter((set) => set.size > 1).length, 0);
});

test("14 - fromMe group messages follow the same group rules", () => {
  const messages = [
    message({ id: "name", offset: 0, textBody: "ساعة NAVIFORCE", fromMe: true, senderId: null }),
    message({ id: "price", offset: 1000, textBody: "السعر 25,000 ريال", fromMe: true, senderId: null }),
    message({ id: "image", offset: 2000, mediaAvailable: true, mediaCount: 1, fromMe: true, senderId: null }),
  ];
  assert.equal(acceptedEdges(messages).length, 2);
  assert.equal(components(messages)[0].size, 3);
});
