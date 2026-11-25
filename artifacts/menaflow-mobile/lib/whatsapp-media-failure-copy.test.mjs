import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

import {
  MEDIA_DOWNLOAD_FAILED_COPY,
  MEDIA_DOWNLOAD_PENDING_COPY,
  MEDIA_UPSTREAM_EXPIRED_COPY,
  MEDIA_UPSTREAM_EXPIRED_REASON,
  describeMediaDownloadFailure,
  isExpiredWhatsAppMediaFailure,
} from "./whatsapp-media-failure-copy.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPolicy = readFileSync(
  path.join(here, "../../api-server/src/lib/whatsapp-media-expiry-policy.ts"),
  "utf8",
);
const serverDownload = readFileSync(
  path.join(here, "../../api-server/src/lib/whatsapp-media-download.ts"),
  "utf8",
);

const now = new Date("2026-11-25T12:00:00Z").getTime();
const days = (n) => n * 24 * 60 * 60 * 1000;

test("the app and the server agree on the expiry window", () => {
  // Two copies of one measured number: the server decides how many attempts a
  // download is worth, the app decides which words the merchant reads. If they
  // drift, one of the two lies.
  const literal = "= 21 * 24 * 60 * 60 * 1000;";
  assert.ok(serverPolicy.includes(literal), "server window literal");
  assert.ok(
    readFileSync(path.join(here, "whatsapp-media-failure-copy.ts"), "utf8").includes(literal),
    "mobile window literal",
  );
});

test("the expiry reason the server records is not retryable", () => {
  const retryable = /function isRetryableMediaError[\s\S]*?\n}/.exec(serverDownload);
  assert.ok(retryable, "the retryable list exists");
  assert.ok(serverPolicy.includes('"WHATSAPP_MEDIA_EXPIRED_UPSTREAM"'));
  assert.ok(
    !retryable[0].includes("WHATSAPP_MEDIA_EXPIRED_UPSTREAM"),
    "an expired object must not be retried on a timer",
  );
});

test("anything not failed is still downloading, as far as the card knows", () => {
  for (const status of ["pending", "stored", "not_required"]) {
    assert.equal(
      describeMediaDownloadFailure({
        downloadStatus: status,
        messageTimestamp: new Date(now - days(30)).toISOString(),
        now,
      }),
      MEDIA_DOWNLOAD_PENDING_COPY,
      `status ${status}`,
    );
  }
});

test("a young message's failure is a failure, and worth another attempt", () => {
  assert.equal(
    describeMediaDownloadFailure({
      downloadStatus: "failed",
      messageTimestamp: new Date(now - days(6)).toISOString(),
      now,
    }),
    MEDIA_DOWNLOAD_FAILED_COPY,
  );
});

test("an old message's failure says the media expired upstream", () => {
  const copy = describeMediaDownloadFailure({
    downloadStatus: "failed",
    messageTimestamp: new Date(now - days(24)).toISOString(),
    now,
  });
  assert.equal(copy, MEDIA_UPSTREAM_EXPIRED_COPY);
  assert.ok(copy.includes("انتهت صلاحية الوسيط لدى واتساب"));
  assert.ok(
    copy.includes("لن ينجح تحميلها مجددًا"),
    "the copy must stop inviting the merchant to retry",
  );
});

test("an unknown send date never blames WhatsApp", () => {
  assert.equal(
    describeMediaDownloadFailure({ downloadStatus: "failed", messageTimestamp: null, now }),
    MEDIA_DOWNLOAD_FAILED_COPY,
  );
  assert.equal(
    describeMediaDownloadFailure({
      downloadStatus: "failed",
      messageTimestamp: "not-a-date",
      now,
    }),
    MEDIA_DOWNLOAD_FAILED_COPY,
  );
});

test("a recorded expiry reason survives an age-less or re-queued row", () => {
  assert.equal(
    describeMediaDownloadFailure({
      downloadStatus: "failed",
      failureReason: MEDIA_UPSTREAM_EXPIRED_REASON,
      messageTimestamp: new Date(now - days(2)).toISOString(),
      now,
    }),
    MEDIA_UPSTREAM_EXPIRED_COPY,
  );
  assert.equal(
    isExpiredWhatsAppMediaFailure({
      failureReason: MEDIA_UPSTREAM_EXPIRED_REASON,
      now,
    }),
    true,
  );
});

test("the boundary belongs to the young side", () => {
  assert.equal(
    describeMediaDownloadFailure({
      downloadStatus: "failed",
      messageTimestamp: new Date(now - days(21)).toISOString(),
      now,
    }),
    MEDIA_DOWNLOAD_FAILED_COPY,
  );
  assert.equal(
    describeMediaDownloadFailure({
      downloadStatus: "failed",
      messageTimestamp: new Date(now - days(21) - 1).toISOString(),
      now,
    }),
    MEDIA_UPSTREAM_EXPIRED_COPY,
  );
});
