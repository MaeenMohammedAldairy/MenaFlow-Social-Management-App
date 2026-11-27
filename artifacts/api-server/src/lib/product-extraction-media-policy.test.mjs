import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWhatsAppExtractionMediaState,
  decideWhatsAppMediaGate,
  shouldResetMediaForRequeue,
} from "./product-extraction-media-policy.ts";

/** A photo message by default: the case the live workspace is full of. */
function message(id, overrides = {}) {
  return {
    id,
    hasText: false,
    mediaAvailable: true,
    mediaDownloadStatus: "stored",
    ...overrides,
  };
}

test("a bundle whose media is all stored is ready and skipped nothing", () => {
  assert.deepEqual(decideWhatsAppMediaGate([message("m1"), message("m2")]), {
    outcome: "ready",
    failedMediaSkipped: [],
  });
});

test("messages without media never hold the gate", () => {
  assert.deepEqual(
    decideWhatsAppMediaGate([
      message("m1", { mediaAvailable: false, mediaDownloadStatus: "failed" }),
      message("m2", { mediaAvailable: false, mediaDownloadStatus: null }),
    ]),
    { outcome: "ready", failedMediaSkipped: [] },
  );
});

test("a download still in flight waits, with or without text", () => {
  for (const status of ["pending", null]) {
    for (const hasText of [true, false]) {
      assert.deepEqual(
        decideWhatsAppMediaGate([
          message("m1", { hasText }),
          message("m2", { mediaDownloadStatus: status }),
        ]),
        {
          outcome: "waiting",
          reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING",
          failedMessageIds: [],
        },
        `status ${status} hasText ${hasText}`,
      );
    }
  }
});

test("a waiting download outranks a dead one: the live one may still bring a photo", () => {
  assert.deepEqual(
    decideWhatsAppMediaGate([
      message("m1", { mediaDownloadStatus: "failed" }),
      message("m2", { mediaDownloadStatus: "pending" }),
    ]),
    {
      outcome: "waiting",
      reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING",
      // Named even though the job waits: the dead download has to be put back on
      // its way now, or the wait ends with the photo still missing.
      failedMessageIds: ["m1"],
    },
  );
});

test("no text and no stored media left is terminal, not waiting", () => {
  // The download worker claims only `pending` messages, so `failed` is never
  // revisited: waiting on it is waiting forever.
  assert.deepEqual(decideWhatsAppMediaGate([message("m1", { mediaDownloadStatus: "failed" })]), {
    outcome: "terminal",
    reason: "WHATSAPP_MEDIA_DOWNLOAD_FAILED",
    messageIds: ["m1"],
  });
});

test("an expired photo does not destroy an offer written in text", () => {
  // The live case: «سعر الطقم 3حبات 2300 ريال فقط» with four photos whose
  // downloads gave up because the message was imported weeks after it was sent.
  // The text is extractable, so the job proceeds and the product simply shows
  // the photo as missing.
  const decision = decideWhatsAppMediaGate([
    message("text", { hasText: true, mediaDownloadStatus: "failed" }),
    message("photo1", { mediaDownloadStatus: "failed" }),
    message("photo2", { mediaDownloadStatus: "failed" }),
  ]);
  assert.deepEqual(decision, {
    outcome: "ready",
    failedMediaSkipped: ["text", "photo1", "photo2"],
  });
});

test("a stored photo keeps a textless bundle readable too", () => {
  // Vision extraction reads the text visible inside a stored image, so one
  // surviving photo is something to extract from even with no caption anywhere.
  assert.deepEqual(
    decideWhatsAppMediaGate([
      message("stored"),
      message("gone", { mediaDownloadStatus: "failed" }),
    ]),
    { outcome: "ready", failedMediaSkipped: ["gone"] },
  );
});

test("every message that gave up is named, once each", () => {
  const decision = decideWhatsAppMediaGate([
    message("m1", { hasText: true, mediaDownloadStatus: "failed" }),
    message("m2", { mediaDownloadStatus: "failed" }),
    message("m1", { mediaDownloadStatus: "failed" }),
    message("m3"),
  ]);
  assert.deepEqual(decision.failedMediaSkipped, ["m1", "m2"]);
});

test("an empty bundle is ready rather than waiting", () => {
  assert.deepEqual(decideWhatsAppMediaGate([]), {
    outcome: "ready",
    failedMediaSkipped: [],
  });
});

test("an unknown status waits rather than failing the job", () => {
  // Failing is irreversible from the merchant's side; waiting is not. Anything
  // this module does not recognise as a give-up stays in the waiting bucket.
  assert.deepEqual(
    decideWhatsAppMediaGate([message("m1", { mediaDownloadStatus: "not_required" })]),
    {
      outcome: "waiting",
      reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING",
      failedMessageIds: [],
    },
  );
  assert.deepEqual(
    decideWhatsAppMediaGate([message("m1", { mediaDownloadStatus: "FAILED" })]),
    {
      outcome: "waiting",
      reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING",
      failedMessageIds: [],
    },
  );
});

test("a re-queue resets media only for messages that gave up", () => {
  assert.equal(shouldResetMediaForRequeue({ mediaAvailable: true, mediaDownloadStatus: "failed" }), true);
  for (const status of ["pending", "stored", "not_required", null]) {
    assert.equal(
      shouldResetMediaForRequeue({ mediaAvailable: true, mediaDownloadStatus: status }),
      false,
      `status ${status}`,
    );
  }
  assert.equal(
    shouldResetMediaForRequeue({ mediaAvailable: false, mediaDownloadStatus: "failed" }),
    false,
    "a message with no media has nothing to download",
  );
});

test("the media state says what the photos did", () => {
  // A suggestion without photos, a suggestion read from all of them, one read
  // from some, one still waiting, and one whose photos are gone for good — five
  // different things a reviewer has to be able to tell apart.
  assert.equal(
    decideWhatsAppExtractionMediaState({ sent: 0, stored: 0, used: 0 }),
    "not_applicable",
  );
  assert.equal(
    decideWhatsAppExtractionMediaState({ sent: 3, stored: 3, used: 3 }),
    "included",
  );
  assert.equal(
    decideWhatsAppExtractionMediaState({ sent: 13, stored: 13, used: 4 }),
    "partial",
    "thirteen photos in storage, the vision cap sent four",
  );
  assert.equal(
    decideWhatsAppExtractionMediaState({ sent: 13, stored: 12, used: 12 }),
    "partial",
    "one download gave up while the rest arrived",
  );
  assert.equal(
    decideWhatsAppExtractionMediaState({ sent: 2, stored: 0, used: 0, pending: 1 }),
    "pending",
  );
  assert.equal(
    decideWhatsAppExtractionMediaState({ sent: 2, stored: 0, used: 0, pending: 0 }),
    "lost",
  );
});
