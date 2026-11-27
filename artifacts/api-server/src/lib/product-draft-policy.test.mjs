import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_PUBLICATION_REQUIRED_FIELDS,
  acceptedExtractionProductFields,
  isProductPublishable,
  missingProductFieldMessages,
  missingProductFields,
  productAdvisoryFields,
  productPublicationBlockers,
  productSuggestionStatus,
  shouldAutoCreateProductDraft,
} from "./product-draft-policy.ts";

/** Reference implementation of the rule that used to live inline in the
 * persistence transaction, kept here so the refactor cannot drift. */
function legacyRule({ classification, name, complete, normalizedName, sku, seenNames, seenSkus }) {
  const duplicate = Boolean(
    (normalizedName && seenNames.has(normalizedName)) || (sku && seenSkus.has(sku)),
  );
  const canCreate =
    classification === "product" && Boolean(name?.trim()) && complete && !duplicate;
  const status =
    classification === "not_product"
      ? "review"
      : duplicate
        ? "possible_duplicate"
        : canCreate
          ? "draft_created"
          : "review";
  return { canCreate, duplicate, status };
}

function candidate(overrides = {}) {
  return {
    classification: "product",
    data: { name: "الزيت الافغاني", sku: "MF-418383F4B01E2F7D" },
    complete: true,
    seenNames: new Set(),
    seenSkus: new Set(),
    ...overrides,
  };
}

test("a complete, unique product candidate becomes an automatic draft", () => {
  const decision = shouldAutoCreateProductDraft(candidate(), "الزيت الافغاني", "MF-418383F4B01E2F7D");
  assert.equal(decision.canCreate, true);
  assert.equal(decision.reason, "auto_draft");
  assert.equal(decision.duplicate, false);
  assert.equal(productSuggestionStatus(candidate(), decision), "draft_created");
});

test("a repeated name or SKU is reported as a possible duplicate, not a draft", () => {
  const byName = shouldAutoCreateProductDraft(
    candidate({ seenNames: new Set(["الزيت الافغاني"]) }),
    "الزيت الافغاني",
    null,
  );
  assert.equal(byName.canCreate, false);
  assert.equal(byName.reason, "duplicate_name");
  assert.equal(byName.duplicate, true);
  assert.equal(productSuggestionStatus(candidate(), byName), "possible_duplicate");

  const bySku = shouldAutoCreateProductDraft(
    candidate({ seenSkus: new Set(["MF-418383F4B01E2F7D"]) }),
    "زيت جديد",
    "MF-418383F4B01E2F7D",
  );
  assert.equal(bySku.reason, "duplicate_sku");
  assert.equal(bySku.duplicate, true);
});

test("incomplete extractions, missing names and non-products stay in review", () => {
  assert.equal(
    shouldAutoCreateProductDraft(candidate({ complete: false }), "x", null).reason,
    "incomplete_extraction",
  );
  assert.equal(
    shouldAutoCreateProductDraft(candidate({ data: { name: "  ", sku: null } }), "", null).reason,
    "missing_name",
  );
  const notProduct = candidate({ classification: "not_product", complete: false });
  const decision = shouldAutoCreateProductDraft(notProduct, "", null);
  assert.equal(decision.reason, "not_product");
  assert.equal(productSuggestionStatus(notProduct, decision), "review");
});

test("image-sourced candidates are never drafted automatically", () => {
  const visionCandidate = candidate({ manualReviewRequired: true });
  const decision = shouldAutoCreateProductDraft(visionCandidate, "الزيت الافغاني", null);
  assert.equal(decision.canCreate, false);
  assert.equal(decision.reason, "manual_review_required");
  assert.equal(productSuggestionStatus(visionCandidate, decision), "review");
});

test("the refactored decision matches the legacy inline rule for every combination", () => {
  const names = ["زيت", "", null];
  const skus = ["MF-1", null];
  const seen = [new Set(), new Set(["زيت"])];
  const seenSkus = [new Set(), new Set(["MF-1"])];
  for (const classification of ["product", "not_product"]) {
    for (const name of names) {
      for (const complete of [true, false]) {
        for (const seenNames of seen) {
          for (const sku of skus) {
            for (const seenSkuSet of seenSkus) {
              const input = candidate({
                classification,
                complete,
                data: { name, sku },
                seenNames,
                seenSkus: seenSkuSet,
              });
              const normalizedName = name?.trim().toLocaleLowerCase() ?? "";
              const decision = shouldAutoCreateProductDraft(input, normalizedName, sku);
              const legacy = legacyRule({
                classification,
                name,
                complete,
                normalizedName,
                sku,
                seenNames,
                seenSkus: seenSkuSet,
              });
              const context = JSON.stringify({ classification, name, complete, sku });
              assert.equal(decision.canCreate, legacy.canCreate, context);
              assert.equal(decision.duplicate, legacy.duplicate, context);
              assert.equal(
                productSuggestionStatus(input, decision),
                legacy.status,
                context,
              );
            }
          }
        }
      }
    }
  }
});

test("the production oil draft is complete enough to review but not to publish", () => {
  const product = {
    name: "الزيت الافغاني",
    description: "الزيت الأكثر استخداما من قبل المشهورات",
    price: null,
    currency: null,
    availability: "in_stock",
    mediaUrls: ["media-1"],
  };
  assert.deepEqual(missingProductFields(product), ["price", "currency"]);
  assert.deepEqual(productPublicationBlockers(product), ["price", "currency"]);
  assert.deepEqual(productAdvisoryFields(product), []);
  assert.equal(isProductPublishable(product), false);
  assert.deepEqual(missingProductFieldMessages(productPublicationBlockers(product)), [
    "السعر",
    "العملة",
  ]);
});

test("a fully filled product with media publishes without blockers", () => {
  const product = {
    name: "سماعة",
    description: "سماعة لاسلكية",
    price: "120",
    currency: "SAR",
    availability: "in_stock",
    mediaUrls: ["media-1"],
  };
  assert.deepEqual(missingProductFields(product), []);
  assert.deepEqual(productPublicationBlockers(product), []);
  assert.equal(isProductPublishable(product), true);
});

test("unknown availability, empty media and a missing description are reported", () => {
  const product = {
    name: "منتج",
    description: "   ",
    price: "10",
    currency: "YER",
    availability: "unknown",
    mediaUrls: [],
  };
  assert.deepEqual(missingProductFields(product), ["description", "availability", "media"]);
  assert.deepEqual(productPublicationBlockers(product), ["availability", "media"]);
  assert.deepEqual(productAdvisoryFields(product), ["description"]);
});

test("media are only judged when the caller supplies them", () => {
  const withoutMedia = {
    name: "منتج",
    description: "وصف",
    price: "10",
    currency: "YER",
    availability: "in_stock",
  };
  assert.deepEqual(missingProductFields(withoutMedia), []);
  assert.deepEqual(missingProductFields({ ...withoutMedia, mediaUrls: null }), []);
  assert.deepEqual(
    missingProductFields({ ...withoutMedia, mediaUrls: ["", "  "] }),
    ["media"],
  );
});

test("the required publication fields stay an explicit, ordered contract", () => {
  assert.deepEqual(PRODUCT_PUBLICATION_REQUIRED_FIELDS, [
    "name",
    "price",
    "currency",
    "availability",
    "media",
  ]);
});

// The accept step is where a merchant turns a card into a product, and it used
// to write `price: null` whenever no currency was resolved. Measured on the
// live workspace: three products holding `raw_price_text` and no number, while
// the publication blocker named «السعر» as missing — the digits the merchant
// wrote were dropped for the want of a word, in the one step a human decided.
test("a merchant's accepted card keeps its number even when no currency was resolved", () => {
  const fields = acceptedExtractionProductFields({
    price: "2500",
    currency: null,
    rawPriceText: "2500",
    priceStatus: "unquoted",
  });
  assert.equal(fields.price, "2500");
  assert.equal(fields.currency, null);
  assert.equal(fields.rawPriceText, "2500");
  assert.equal(fields.priceStatus, "unquoted");
});

test("an accepted card with a resolved currency is publishable material", () => {
  const fields = acceptedExtractionProductFields({
    price: "2500",
    currency: "YER",
    rawPriceText: "2500 ريال يمني",
    priceStatus: "confirmed",
  });
  assert.equal(fields.price, "2500");
  assert.equal(fields.currency, "YER");
  assert.deepEqual(
    productPublicationBlockers({
      ...fields,
      name: "دفاية",
      description: null,
      availability: "in_stock",
      mediaUrls: ["m1"],
    }),
    [],
  );
});

test("a number the extraction never found is not invented at accept", () => {
  const fields = acceptedExtractionProductFields({
    price: null,
    currency: "YER",
    rawPriceText: null,
    priceStatus: "missing",
  });
  assert.equal(fields.price, null);
  // A currency without a price is nothing to publish, and nothing to keep: the
  // blocker list names the price, so the card stays honest about the gap.
  assert.equal(fields.currency, "YER");
  assert.deepEqual(
    productPublicationBlockers({
      ...fields,
      name: "دفاية",
      description: null,
      availability: "in_stock",
      mediaUrls: ["m1"],
    }),
    ["price"],
  );
});
