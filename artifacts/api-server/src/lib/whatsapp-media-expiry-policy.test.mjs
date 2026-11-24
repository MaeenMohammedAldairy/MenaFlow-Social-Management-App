import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_UPSTREAM_EXPIRED_REASON,
  MEDIA_UPSTREAM_EXPIRY_AGE_MS,
  mediaDownloadAttemptLimit,
  mediaDownloadFailureReason,
  isExpiredWhatsAppMediaFailure,
  messageAgeMs,
} from "./whatsapp-media-expiry-policy.ts";

const now = new Date("2026-11-25T12:00:00Z");
const days = (n) => n * 24 * 60 * 60 * 1000;

test("the expiry window sits between the observed success and failure ages", () => {
  // Live evidence: six-to-twelve-day-old messages downloaded on the first
  // attempt; twenty-four-to-twenty-five-day-old ones never downloaded at all.
  assert.ok(MEDIA_UPSTREAM_EXPIRY_AGE_MS > days(12));
  assert.ok(MEDIA_UPSTREAM_EXPIRY_AGE_MS < days(24));
  assert.equal(MEDIA_UPSTREAM_EXPIRY_AGE_MS, days(21));
});

test("age is measured from when the message was sent, not imported", () => {
  assert.equal(
    messageAgeMs(new Date("2026-11-24T12:00:00Z"), now),
    days(1),
  );
  assert.equal(
    messageAgeMs("2026-10-30T21:01:03.000Z", now),
    now.getTime() - new Date("2026-10-30T21:01:03.000Z").getTime(),
  );
  assert.equal(messageAgeMs(null, now), null);
  assert.equal(messageAgeMs(undefined, now), null);
  assert.equal(messageAgeMs("not-a-date", now), null);
});

test("a message from the future is treated as age zero, not negative", () => {
  assert.equal(messageAgeMs(new Date("2026-12-01T00:00:00Z"), now), 0);
});

test("an old message gets one attempt; anything younger keeps the budget", () => {
  assert.equal(
    mediaDownloadAttemptLimit({ messageAgeMs: days(24), defaultLimit: 5 }),
    1,
  );
  assert.equal(
    mediaDownloadAttemptLimit({ messageAgeMs: days(21), defaultLimit: 5 }),
    5,
    "the boundary itself is still inside the window",
  );
  assert.equal(
    mediaDownloadAttemptLimit({ messageAgeMs: days(21) + 1, defaultLimit: 5 }),
    1,
  );
  assert.equal(
    mediaDownloadAttemptLimit({ messageAgeMs: days(6), defaultLimit: 5 }),
    5,
  );
  assert.equal(
    mediaDownloadAttemptLimit({ messageAgeMs: null, defaultLimit: 5 }),
    5,
    "an unknown age must behave like a fresh message",
  );
});

test("an old message's failure is recorded as expiry, not as a transport error", () => {
  assert.equal(
    mediaDownloadFailureReason({
      messageAgeMs: days(25),
      errorCode: "EVOLUTION_API_REQUEST_FAILED",
    }),
    MEDIA_UPSTREAM_EXPIRED_REASON,
  );
  assert.equal(
    mediaDownloadFailureReason({
      messageAgeMs: days(6),
      errorCode: "EVOLUTION_API_REQUEST_FAILED",
    }),
    "EVOLUTION_API_REQUEST_FAILED",
  );
  assert.equal(
    mediaDownloadFailureReason({ messageAgeMs: null, errorCode: "ECONNRESET" }),
    "ECONNRESET",
  );
});

test("the expiry reason is a stable, namespaced code", () => {
  assert.equal(MEDIA_UPSTREAM_EXPIRED_REASON, "WHATSAPP_MEDIA_EXPIRED_UPSTREAM");
});

test("an expired item is recognised by its reason even after a re-queue", () => {
  assert.equal(
    isExpiredWhatsAppMediaFailure({
      downloadStatus: "failed",
      failureReason: MEDIA_UPSTREAM_EXPIRED_REASON,
      messageTimestamp: new Date("2026-11-20T12:00:00Z"),
      now,
    }),
    true,
  );
});

test("rows without the new reason still fall back to the message age", () => {
  assert.equal(
    isExpiredWhatsAppMediaFailure({
      downloadStatus: "failed",
      messageTimestamp: new Date("2026-10-30T12:00:00Z"),
      now,
    }),
    true,
  );
  assert.equal(
    isExpiredWhatsAppMediaFailure({
      downloadStatus: "failed",
      messageTimestamp: new Date("2026-11-20T12:00:00Z"),
      now,
    }),
    false,
  );
});

test("stored or pending media is never treated as expired", () => {
  for (const downloadStatus of ["stored", "pending", "not_required"]) {
    assert.equal(
      isExpiredWhatsAppMediaFailure({
        downloadStatus,
        failureReason: MEDIA_UPSTREAM_EXPIRED_REASON,
        now,
      }),
      false,
    );
  }
});
