/**
 * The three derivations the extraction review card makes from what the run *did*.
 *
 * Each one exists because the alternative was a card that said something false:
 * silence about the photos made a text-only reading look complete, a green
 * «أُعيد التحليل» was shown even when the server refused the second reading, and
 * a fact the model invented sat on the card looking exactly like one the merchant
 * wrote.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  productExtractionFactLines,
  productExtractionMediaNote,
  productExtractionReprocessNotice,
} from "./product-extraction-card-copy.ts";

test("a photo the reading could not use is said out loud", () => {
  for (const state of ["partial", "lost", "pending"]) {
    assert.equal(
      productExtractionMediaNote({
        mediaState: state,
        mediaStateMessage: "وصلت بعض صور المجموعة بعد أن قرأ النموذج النص.",
      }),
      "وصلت بعض صور المجموعة بعد أن قرأ النموذج النص.",
      `media_state=${state} has to reach the card`,
    );
  }
  // Nothing went wrong in these two, so a warning about photos would be a lie
  // about a message that never had any.
  for (const state of ["included", "not_applicable"]) {
    assert.equal(
      productExtractionMediaNote({
        mediaState: state,
        mediaStateMessage: "وصلت بعض الصور متأخرة.",
      }),
      null,
    );
  }
  // A state without its sentence is a contract gap. The card stays quiet rather
  // than inventing a line about the wrong problem.
  assert.equal(productExtractionMediaNote({ mediaState: "lost" }), null);
  assert.equal(productExtractionMediaNote({}), null);
});

test("the notice after a reprocess says what was actually armed", () => {
  assert.equal(
    productExtractionReprocessNotice([{ queued: true, reopened: 3, created: 1 }])
      .tone,
    "success",
  );
  assert.match(
    productExtractionReprocessNotice([{ queued: true, reopened: 3, created: 1 }])
      .message,
    /4/,
    "the merchant is told how many messages went back to the queue",
  );
  // The case that read as success for days: the server answered 202 and armed
  // nothing, because the group had already been read at this ruleset version.
  const covered = productExtractionReprocessNotice([
    { queued: false, reopened: 0, created: 0 },
  ]);
  assert.equal(covered.tone, "info");
  assert.match(covered.title, /لم تبدأ/);
  // A job that nobody polls is not a request that will be served.
  const parked = productExtractionReprocessNotice([
    { queued: true, reopened: 2, workerEnabled: false },
  ]);
  assert.equal(parked.tone, "info");
  assert.match(parked.message, /الطابور|عامل الاستخراج/);
  // A bulk decision is only a success if some group was armed.
  const bulk = productExtractionReprocessNotice([
    { queued: false, reopened: 0, created: 0 },
    { queued: true, reopened: 2, created: 0 },
  ]);
  assert.equal(bulk.tone, "success");
  assert.equal(bulk.title, "أُعيدت الرسائل إلى التحليل");
  // One row re-armed is not a bulk action: the notice counts what happened.
  assert.equal(
    productExtractionReprocessNotice([{ queued: true, reopened: 1 }]).title,
    "أُعيدت الرسالة إلى التحليل",
  );
});

test("a fact is shown with the label of its kind, and marked without a quote", () => {
  const lines = productExtractionFactLines({
    features: [
      { value: "12 رأس تدليك", verified: true },
      { value: "شاحن سريع", verified: false },
    ],
    specifications: [{ value: "مقاومة للماء IPX7", verified: true }],
    accessories: [],
  });
  assert.deepEqual(
    lines.map((line) => line.text),
    [
      "مزايا: 12 رأس تدليك",
      "مزايا: شاحن سريع",
      "مواصفات: مقاومة للماء IPX7",
    ],
  );
  assert.deepEqual(
    lines.map((line) => line.verified),
    [true, false, true],
    "the unverified lead is the one a publication must not repeat",
  );
  assert.equal(productExtractionFactLines(undefined).length, 0);
  assert.equal(productExtractionFactLines({ features: "not a list" }).length, 0);
  assert.equal(productExtractionFactLines({ features: [{ value: "  " }] }).length, 0);
});
