import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedProductSku,
  isCompleteProductExtraction,
  normalizeProductExtractionResponse,
  productExtractionSourceKey,
} from "./product-extraction.ts";

const source = {
  id: "message-1",
  groupId: "group-1",
  messageTimestamp: "2026-10-30T10:00:00.000Z",
  replyToMessageId: null,
  text: "حقيبة سفر كبيرة، السعر ١٢٥ ريال، متوفرة الآن",
};

function extraction(overrides = {}) {
  return {
    nonProductMessageIds: [],
    products: [
      {
        sourceMessageIds: [source.id],
        data: {
          name: "حقيبة سفر كبيرة",
          sku: null,
          aliases: [],
          description: "حقيبة سفر كبيرة",
          price: "125",
          currency: "SAR",
          availability: "in_stock",
          ...overrides.data,
        },
        evidence: {
          name: "حقيبة سفر كبيرة",
          aliases: null,
          description: "حقيبة سفر كبيرة",
          price: "١٢٥ ريال",
          currency: "ريال",
          availability: "متوفرة الآن",
          ...overrides.evidence,
        },
        confidence: {
          name: 0.96,
          aliases: 0,
          description: 0.9,
          price: 0.95,
          currency: 0.93,
          availability: 0.9,
          ...overrides.confidence,
        },
      },
    ],
  };
}

test("accepts a complete candidate only when every required field is grounded", () => {
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(extraction()),
    [source],
  );
  assert.equal(candidate.data.sku, null);
  assert.equal(candidate.evidence.sku, null);
  assert.equal(candidate.data.price, "125");
  assert.equal(candidate.data.currency, "SAR");
  assert.equal(candidate.complete, true);
  assert.equal(isCompleteProductExtraction(candidate), true);
});

test("generates a stable SKU from source message IDs", () => {
  const sku = generatedProductSku(["message-1", "message-2"]);
  assert.match(sku, /^MF-[A-F0-9]{16}$/);
  assert.equal(sku, generatedProductSku(["message-2", "message-1"]));
});

test("parses fenced JSON and numeric prices when the source has one grounded price", () => {
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    `\`\`\`json\n${JSON.stringify(extraction({
      data: { price: 125 },
    }))}\n\`\`\``,
    [source],
  );
  assert.equal(candidate.data.price, "125");
  assert.equal(candidate.complete, true);
});

test("does not keep model-invented names, descriptions, or prices", () => {
  const payload = extraction({
    data: {
      name: "منتج غير موجود في الإعلان",
      description: "وصف مختلق",
      price: "999",
    },
    evidence: {
      name: "حقيبة سفر كبيرة",
      description: "حقيبة سفر كبيرة",
      price: "١٢٥ ريال",
    },
  });
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(payload),
    [source],
  );
  assert.equal(candidate.data.name, null);
  assert.equal(candidate.data.description, "حقيبة سفر كبيرة");
  assert.equal(candidate.data.price, null);
  assert.equal(candidate.complete, false);
});

test("keeps products with multiple advertised prices as drafts without a price", () => {
  const multiPriceSource = {
    ...source,
    text: `${source.text} فقط ب 17500 ريال وبالسعودي 125`,
  };
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(extraction({
      data: { price: "17500" },
      evidence: { price: "17500 ريال" },
    })),
    [multiPriceSource],
  );
  assert.equal(candidate.data.price, null);
  assert.equal(candidate.data.currency, null);
  assert.equal(candidate.complete, false);
});

test("generates relevant aliases from the product name without accepting unrelated names", () => {
  const payload = extraction({
    data: { aliases: ["شنطة السفر", "سيارة فاخرة"] },
    evidence: { aliases: "حقيبة سفر كبيرة" },
    confidence: { aliases: 0.93 },
  });
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(payload),
    [source],
  );
  assert.deepEqual(candidate.data.aliases, ["شنطة السفر"]);
});

test("preserves an explicitly sourced SKU instead of generating one", () => {
  const skuSource = {
    ...source,
    text: `${source.text} رقم المنتج BAG-125`,
  };
  const payload = extraction({
    data: { sku: "BAG-125" },
    evidence: { sku: "رقم المنتج BAG-125" },
    confidence: { sku: 0.95 },
  });
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(payload),
    [skuSource],
  );
  assert.equal(candidate.data.sku, "BAG-125");
});

test("normalizes Arabic-Indic price digits and refuses unsupported evidence", () => {
  const payload = extraction({
    data: { price: "١٢٥" },
    evidence: { description: "حقيبة بمواصفات فاخرة لا توجد في الرسالة" },
  });
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(payload),
    [source],
  );
  assert.equal(candidate.data.price, "125");
  assert.equal(candidate.data.description, null);
  assert.equal(candidate.evidence.description, null);
  assert.equal(candidate.confidence.description, 0);
  assert.equal(candidate.complete, false);
});

test("marks missing or low-confidence fields for review", () => {
  const payload = extraction({
    data: { availability: null },
    confidence: { price: 0.7 },
  });
  const { candidates: [candidate] } = normalizeProductExtractionResponse(
    JSON.stringify(payload),
    [source],
  );
  assert.equal(candidate.complete, false);
});

test("classifies every non-product message for recall review", () => {
  const { candidates } = normalizeProductExtractionResponse(
    JSON.stringify({ products: [], nonProductMessageIds: [source.id] }),
    [source],
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].classification, "not_product");
  assert.equal(candidates[0].sourceMessageIds[0], source.id);
  assert.equal(candidates[0].data.name, null);
});

test("rejects unknown and multiply assigned source messages", () => {
  const unknownSource = extraction();
  unknownSource.products[0].sourceMessageIds = ["not-imported"];
  assert.throws(
    () =>
      normalizeProductExtractionResponse(
        JSON.stringify(unknownSource),
        [source],
      ),
    /PRODUCT_EXTRACTION_INVALID_SOURCE_GROUPING/,
  );

  const duplicateSource = extraction();
  duplicateSource.products.push({
    ...duplicateSource.products[0],
    data: { ...duplicateSource.products[0].data },
  });
  assert.throws(
    () =>
      normalizeProductExtractionResponse(
        JSON.stringify(duplicateSource),
        [source],
      ),
    /PRODUCT_EXTRACTION_INVALID_SOURCE_GROUPING/,
  );
});

test("rejects omitted messages and cross-group product clusters", () => {
  assert.throws(
    () =>
      normalizeProductExtractionResponse(
        JSON.stringify({ products: [], nonProductMessageIds: [] }),
        [source],
      ),
    /PRODUCT_EXTRACTION_INCOMPLETE_SOURCE_CLASSIFICATION/,
  );
  const otherGroup = { ...source, id: "message-2", groupId: "group-2" };
  const crossGroup = extraction();
  crossGroup.products[0].sourceMessageIds.push(otherGroup.id);
  assert.throws(
    () =>
      normalizeProductExtractionResponse(
        JSON.stringify(crossGroup),
        [source, otherGroup],
      ),
    /PRODUCT_EXTRACTION_CROSS_GROUP_CANDIDATE/,
  );
});

test("uses a stable, order-independent source key", () => {
  assert.equal(
    productExtractionSourceKey(["message-1", "message-2"]),
    productExtractionSourceKey(["message-2", "message-1"]),
  );
});
