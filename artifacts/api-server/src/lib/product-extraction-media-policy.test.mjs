import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWhatsAppMediaGate,
  shouldResetMediaForRequeue,
} from "./product-extraction-media-policy.ts";

function message(id, overrides = {}) {
  return { id, mediaAvailable: true, mediaDownloadStatus: "stored", ...overrides };
}

test("a bundle whose media is all stored is ready", () => {
  assert.deepEqual(decideWhatsAppMediaGate([message("m1"), message("m2")]), {
    outcome: "ready",
  });
});

test("messages without media never hold the gate", () => {
  assert.deepEqual(
    decideWhatsAppMediaGate([
      message("m1", { mediaAvailable: false, mediaDownloadStatus: "failed" }),
      message("m2", { mediaAvailable: false, mediaDownloadStatus: null }),
    ]),
    { outcome: "ready" },
  );
});

test("a download still in flight waits", () => {
  for (const status of ["pending", null]) {
    assert.deepEqual(
      decideWhatsAppMediaGate([message("m1"), message("m2", { mediaDownloadStatus: status })]),
      { outcome: "waiting", reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING" },
      `status ${status}`,
    );
  }
});

test("a download that gave up is terminal, not waiting", () => {
  // The download worker claims only `pending` messages, so `failed` is never
  // revisited: waiting on it is waiting forever.
  assert.deepEqual(decideWhatsAppMediaGate([message("m1", { mediaDownloadStatus: "failed" })]), {
    outcome: "terminal",
    reason: "WHATSAPP_MEDIA_DOWNLOAD_FAILED",
    messageIds: ["m1"],
  });
});

test("one terminal message in a bundle makes the whole bundle terminal", () => {
  const decision = decideWhatsAppMediaGate([
    message("m1"),
    message("m2", { mediaDownloadStatus: "pending" }),
    message("m3", { mediaDownloadStatus: "failed" }),
  ]);
  assert.equal(decision.outcome, "terminal");
  assert.deepEqual(decision.messageIds, ["m3"]);
});

test("every message that gave up is named, once each", () => {
  const decision = decideWhatsAppMediaGate([
    message("m1", { mediaDownloadStatus: "failed" }),
    message("m2", { mediaDownloadStatus: "failed" }),
    message("m1", { mediaDownloadStatus: "failed" }),
    message("m3"),
  ]);
  assert.deepEqual(decision.messageIds, ["m1", "m2"]);
});

test("an empty bundle is ready rather than waiting", () => {
  assert.deepEqual(decideWhatsAppMediaGate([]), { outcome: "ready" });
});

test("an unknown status waits rather than failing the job", () => {
  // Failing is irreversible from the merchant's side; waiting is not. Anything
  // this module does not recognise as a give-up stays in the waiting bucket.
  assert.deepEqual(
    decideWhatsAppMediaGate([message("m1", { mediaDownloadStatus: "not_required" })]),
    { outcome: "waiting", reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING" },
  );
  assert.deepEqual(
    decideWhatsAppMediaGate([message("m1", { mediaDownloadStatus: "FAILED" })]),
    { outcome: "waiting", reason: "WHATSAPP_MEDIA_DOWNLOAD_PENDING" },
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
