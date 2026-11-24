import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChangeDiff,
  classifySenderRole,
  evolutionWebhookEventKey,
  computeExtractionConfidence,
  extractionConfidenceReasons,
  matchProductCandidate,
  requiresOverrideReason,
} from "./product-intake-policy.ts";

const data = {
  name: "زيت أفغاني",
  price: "120",
  currency: "YER",
  availability: "in_stock",
  description: "زيت طبيعي",
  aliases: ["زيت طبيعي"],
};
const evidence = {
  name: "زيت أفغاني",
  price: "120",
  currency: "YER",
  availability: "متوفر",
  description: "زيت طبيعي",
  aliases: "زيت طبيعي",
};

test("confidence is computed from evidence and source trust, not model self-report", () => {
  const merchant = computeExtractionConfidence({ data, evidence, senderRole: "merchant" });
  const customer = computeExtractionConfidence({ data, evidence, senderRole: "customer" });
  const ungrounded = computeExtractionConfidence({
    data,
    evidence: {},
    senderRole: "merchant",
  });
  assert.ok(merchant > customer);
  assert.ok(merchant > ungrounded);
  assert.ok(merchant <= 1 && merchant >= 0);
});

test("confidence drops when several prices or a country-derived currency conflict", () => {
  const base = computeExtractionConfidence({ data, evidence, senderRole: "merchant" });
  const conflicted = computeExtractionConfidence({
    data,
    evidence,
    senderRole: "merchant",
    multiplePriceMentions: true,
    currencyDerivedFromCountry: true,
  });
  assert.ok(conflicted < base);
});

test("sender role comes from fromMe or a known merchant sender", () => {
  assert.equal(classifySenderRole({ fromMe: true }), "merchant");
  assert.equal(classifySenderRole({ senderId: "s1", merchantSenderIds: ["s1"] }), "merchant");
  assert.equal(classifySenderRole({ senderId: "customer-1" }), "customer");
  assert.equal(classifySenderRole({}), "unknown");
});

test("an exact SKU blocks product creation unless an override reason is given", () => {
  const match = matchProductCandidate({
    name: "زيت أفغاني 250ml",
    sku: "MF-123",
    products: [
      { id: "p1", name: "زيت آخر", sku: "MF-123", aliases: [] },
    ],
  });
  assert.equal(match.strategy, "exact_sku");
  assert.equal(match.productId, "p1");
  assert.equal(requiresOverrideReason(match.strategy), true);
});

test("name and alias matches are detected, fuzzy matches stay reviewable", () => {
  const products = [
    { id: "p1", name: "زيت أفغاني", sku: null, aliases: ["زيت طبيعي"] },
  ];
  assert.equal(
    matchProductCandidate({ name: "زيت أفغاني", products }).strategy,
    "exact_name",
  );
  assert.equal(
    matchProductCandidate({ name: "منتج آخر", aliases: ["زيت طبيعي"], products }).strategy,
    "alias_match",
  );
  const fuzzy = matchProductCandidate({ name: "زيت أفغاني 250", products });
  assert.equal(fuzzy.strategy, "fuzzy_candidate");
  assert.equal(requiresOverrideReason(fuzzy.strategy), false);
});

test("no match returns new_product with zero score", () => {
  const result = matchProductCandidate({ name: "شيء آخر تماماً", products: [] });
  assert.equal(result.strategy, "new_product");
  assert.equal(result.score, 0);
});

test("confidence reasons explain the score in merchant language", () => {
  const reasons = extractionConfidenceReasons({
    data,
    evidence,
    senderRole: "customer",
    vision: true,
  });
  assert.ok(reasons.some((reason) => reason.includes("عميل")));
  assert.ok(!reasons.some((reason) => reason.includes("رسالة من التاجر")));
  assert.ok(reasons.some((reason) => reason.includes("صورة")));
  assert.ok(reasons.some((reason) => reason.includes("دليل نصي")));
});

test("webhook event keys ignore volatile fields but keep message identity", () => {
  const body = {
    event: "messages.upsert",
    instance: "menaflow-1",
    data: {
      upsert: {
        message: {
          key: { id: "ABC", remoteJid: "group@g.us", fromMe: false },
          messageTimestamp: 1,
        },
      },
    },
  };
  const retry = structuredClone(body);
  retry.data.upsert.message.messageTimestamp = 999;
  assert.equal(evolutionWebhookEventKey(body), evolutionWebhookEventKey(retry));
  retry.data.upsert.message.key.id = "OTHER";
  assert.notEqual(evolutionWebhookEventKey(body), evolutionWebhookEventKey(retry));
  assert.equal(evolutionWebhookEventKey({}), null);
});

test("change diff only contains changed fields and carries evidence", () => {
  const diff = buildChangeDiff(
    ["price", "name"],
    { price: "120", name: "زيت" },
    { price: "135", name: "زيت" },
    { price: "135 ريال" },
  );
  assert.deepEqual(Object.keys(diff), ["price"]);
  assert.equal(diff.price.evidence, "135 ريال");
});
