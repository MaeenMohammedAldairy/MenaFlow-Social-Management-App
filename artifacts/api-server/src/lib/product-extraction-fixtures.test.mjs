import assert from "node:assert/strict";
import test from "node:test";
import {
  reviewFixtureCaseId,
  reviewFixtureFromSuggestion,
  reviewFixturesFromSuggestions,
  serializeReviewFixtures,
  summarizeReviewVerdicts,
} from "./product-extraction-fixtures.ts";
import { normalizeProductExtractionResponse } from "./product-extraction.ts";

function suggestion(overrides = {}) {
  return {
    id: "655b7b3b-1ee0-420c-b2a8-ceaa370c3539",
    classification: "product",
    extractedData: {
      name: "الزيت الافغاني",
      sku: null,
      aliases: ["زيت"],
      description: "الزيت الافغاني 100 مل",
      price: "45",
      currency: "SAR",
      availability: null,
    },
    evidence: {
      name: "الزيت الافغاني",
      sku: null,
      aliases: "الزيت الافغاني",
      description: "الزيت الافغاني 100 مل",
      price: "45 ريال سعودي",
      currency: "ريال سعودي",
      availability: null,
    },
    confidence: {
      name: 0.95,
      sku: 0,
      aliases: 0.7,
      description: 0.9,
      price: 0.9,
      currency: 0.9,
      availability: 0,
    },
    fieldReview: { name: true, price: false, grouping: true },
    aiModel: "gemini-2.5-flash",
    reviewedAt: "2026-11-24T02:40:00.000Z",
    sources: [
      {
        id: "message-1",
        groupId: "bundle:1",
        messageTimestamp: "2026-11-24T02:20:00.000Z",
        replyToMessageId: null,
        text: "الزيت الافغاني 100 مل - السعر 45 ريال سعودي",
      },
    ],
    ...overrides,
  };
}

test("a reviewed suggestion becomes a replayable benchmark case", () => {
  const fixture = reviewFixtureFromSuggestion(suggestion());
  assert.ok(fixture);
  assert.equal(fixture.source, "merchant_review");
  assert.equal(fixture.classification, "product");
  assert.deepEqual(fixture.messages.map((message) => message.id), ["1"]);
  assert.deepEqual(fixture.target.products[0].sourceMessageIds, ["1"]);
  assert.deepEqual(fixture.incorrectFields, ["price"]);
  assert.deepEqual(fixture.verdicts, { grouping: true, name: true, price: false });

  // The whole point: the case runs through the production normalizer.
  const normalized = normalizeProductExtractionResponse(
    JSON.stringify(fixture.target),
    fixture.messages,
  );
  assert.equal(normalized.candidates.length, 1);
  assert.equal(normalized.candidates[0].data.name, "الزيت الافغاني");
  assert.equal(normalized.candidates[0].data.price, "45");
});

test("the case id is hashed, stable and free of production identifiers", () => {
  const fixture = reviewFixtureFromSuggestion(suggestion());
  assert.ok(fixture);
  assert.equal(fixture.caseId, reviewFixtureCaseId(suggestion().id));
  assert.match(fixture.caseId, /^rev-[0-9a-f]{12}$/);
  assert.equal(
    reviewFixtureCaseId("other-id"),
    reviewFixtureCaseId("other-id"),
  );
  assert.notEqual(fixture.caseId, reviewFixtureCaseId("other-id"));
  const serialized = serializeReviewFixtures([fixture]);
  assert.doesNotMatch(serialized, /655b7b3b/);
  assert.doesNotMatch(serialized, /message-1/);
});

test("suggestions that teach nothing are skipped", () => {
  assert.equal(reviewFixtureFromSuggestion(suggestion({ fieldReview: {} })), null);
  assert.equal(reviewFixtureFromSuggestion(suggestion({ fieldReview: null })), null);
  assert.equal(reviewFixtureFromSuggestion(suggestion({ sources: [] })), null);
  assert.equal(
    reviewFixtureFromSuggestion(
      suggestion({ sources: [{ id: "m", groupId: "g", messageTimestamp: null, replyToMessageId: null, text: "   " }] }),
    ),
    null,
  );
  // Non-boolean verdicts (a malformed row) are ignored rather than recorded.
  assert.equal(
    reviewFixtureFromSuggestion(suggestion({ fieldReview: { name: "yes" } })),
    null,
  );
});

test("a not-a-product verdict keeps every source out of the product list", () => {
  const fixture = reviewFixtureFromSuggestion(
    suggestion({
      classification: "not_product",
      fieldReview: { classification: false },
      sources: [
        { id: "m1", groupId: "g1", messageTimestamp: null, replyToMessageId: null, text: "تم التحويل" },
        { id: "m2", groupId: "g1", messageTimestamp: null, replyToMessageId: "m1", text: "شكراً" },
      ],
    }),
  );
  assert.ok(fixture);
  assert.deepEqual(fixture.target.products, []);
  assert.deepEqual(fixture.target.nonProductMessageIds, ["1", "2"]);
  assert.deepEqual(fixture.incorrectFields, ["classification"]);
  const normalized = normalizeProductExtractionResponse(
    JSON.stringify(fixture.target),
    fixture.messages,
  );
  assert.equal(normalized.candidates.length, 2);
  assert.ok(normalized.candidates.every((candidate) => candidate.classification === "not_product"));
});

test("fixtures are ordered deterministically for a stable diff", () => {
  const fixtures = reviewFixturesFromSuggestions([
    suggestion({ id: "zzz" }),
    suggestion({ id: "aaa" }),
    suggestion({ id: "mmm", fieldReview: {} }),
  ]);
  assert.equal(fixtures.length, 2);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.caseId),
    [...fixtures.map((fixture) => fixture.caseId)].sort(),
  );
});

test("serialization is JSONL with a trailing newline and parses back", () => {
  const fixtures = reviewFixturesFromSuggestions([suggestion(), suggestion({ id: "second" })]);
  const serialized = serializeReviewFixtures(fixtures);
  assert.equal(serialized.endsWith("\n"), true);
  const lines = serialized.split("\n").filter(Boolean);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => JSON.parse(line).caseId), fixtures.map((fixture) => fixture.caseId));
  assert.equal(serializeReviewFixtures([]), "");
});

test("the verdict summary reports accuracy per field", () => {
  const summary = summarizeReviewVerdicts([
    suggestion({ fieldReview: { name: true, price: false } }),
    suggestion({ id: "b", fieldReview: { name: false, classification: true } }),
    suggestion({ id: "c", fieldReview: {} }),
  ]);
  assert.deepEqual(summary, {
    suggestions: 3,
    reviewed: 2,
    verdicts: 4,
    correct: 2,
    incorrect: 2,
    byField: {
      classification: { correct: 1, incorrect: 0 },
      name: { correct: 1, incorrect: 1 },
      price: { correct: 0, incorrect: 1 },
    },
  });
});
