import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const {
  describeWhatsAppSyncStatus,
  describeWhatsAppSyncFailure,
} = await import("./whatsapp-sync-copy.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "../../api-server/src");

/**
 * Codes the sync path emits that are never written to
 * `mena_whatsapp_sync_states.last_error`: log event names, webhook setup
 * errors answered straight to the caller, and codes from the send path. Each
 * entry says why it is excluded, so adding a code here is a deliberate act
 * rather than a way to silence the drift gate below.
 */
const NOT_SYNC_STATE_ERRORS = new Map([
  ["WHATSAPP_HISTORY_FILTER_IGNORED_FALLING_BACK_TO_SCAN", "log event name"],
  ["WHATSAPP_HISTORY_SCAN_PAGE_CAP_REACHED", "log event name"],
  [
    // Warn-level log event for a reply postponed by a limit that lifts by
    // itself. The merchant sees the stored `error_code`
    // (SUBSCRIPTION_LIMIT_REACHED:…) through lib/whatsapp-auto-reply-copy.ts,
    // never this name.
    "WHATSAPP_AUTO_REPLY_PAUSED_FOR_LIMIT",
    "log event name, not stored in last_error",
  ],
  ["WHATSAPP_WEBHOOK_SECRET_REQUIRED", "webhook setup, answered to the caller"],
  ["WHATSAPP_WEBHOOK_URL_REQUIRED", "webhook setup, answered to the caller"],
  ["WHATSAPP_WEBHOOK_URL_INVALID", "webhook setup, answered to the caller"],
  ["WHATSAPP_WEBHOOK_RECONFIGURE_FAILED", "webhook setup, answered to the caller"],
  ["WHATSAPP_RECIPIENT_PHONE_REQUIRED", "send path, not sync"],
  ["WHATSAPP_DIRECT_MESSAGE_NOT_FOUND", "inbox read path, not sync"],
  ["EVOLUTION_API_RESPONSE_LIMIT_INVALID", "programmer error, throws a RangeError"],
]);

const SYNC_SOURCE_FILES = [
  "lib/whatsapp-sync.ts",
  "lib/whatsapp-history.ts",
  "lib/whatsapp-evolution.ts",
  "routes/whatsapp-sync.ts",
];

function codesEmittedBySyncPath() {
  const codes = new Set();
  for (const relative of SYNC_SOURCE_FILES) {
    const source = readFileSync(path.join(serverRoot, relative), "utf8");
    for (const match of source.matchAll(/"(?:EVOLUTION|WHATSAPP)_[A-Z0-9_]+"/g)) {
      codes.add(match[0].slice(1, -1));
    }
  }
  return codes;
}

test("every sync status the server records has an Arabic label", () => {
  for (const status of [
    "idle",
    "running",
    "complete",
    "partial",
    "failed",
    "cancelled",
    "empty",
  ]) {
    const label = describeWhatsAppSyncStatus(status);
    assert.ok(label.length > 0, status);
    assert.ok(!/[A-Za-z]/.test(label), `${status} leaked latin: ${label}`);
  }
});

test("status labels normalise case and never echo the raw value", () => {
  assert.equal(describeWhatsAppSyncStatus("COMPLETE"), "اكتملت المزامنة");
  assert.equal(describeWhatsAppSyncStatus("  running "), "جارٍ الاستيراد");
  assert.equal(describeWhatsAppSyncStatus(null), "لم تبدأ");
  assert.equal(describeWhatsAppSyncStatus(""), "لم تبدأ");
  assert.equal(describeWhatsAppSyncStatus("weird_state"), "حالة غير معروفة");
});

test("known failures are explained without showing the code", () => {
  const message = describeWhatsAppSyncFailure("EVOLUTION_HISTORY_GROUP_MISMATCH");
  assert.ok(message);
  assert.ok(!message.includes("EVOLUTION_HISTORY_GROUP_MISMATCH"), message);
  assert.ok(message.includes("المزامنة"), message);
});

test("an unknown failure still tells the merchant what to do, and keeps the code", () => {
  const message = describeWhatsAppSyncFailure("SOMETHING_NEW");
  assert.ok(message);
  assert.ok(message.includes("SOMETHING_NEW"), message);
  assert.ok(message.includes("الدعم"), message);
});

test("failure copy tolerates empty input", () => {
  assert.equal(describeWhatsAppSyncFailure(null), null);
  assert.equal(describeWhatsAppSyncFailure("   "), null);
});

test("every code the sync path can record has merchant copy", () => {
  // The drift gate: a new code in the sync modules fails here until it is
  // either translated for the merchant or excluded with a reason above.
  const missing = [...codesEmittedBySyncPath()]
    .filter((code) => !NOT_SYNC_STATE_ERRORS.has(code))
    .filter((code) => describeWhatsAppSyncFailure(code)?.includes(`(${code})`))
    .sort();
  assert.deepEqual(missing, []);
});

test("the exclusion list stays honest", () => {
  const emitted = codesEmittedBySyncPath();
  const stale = [...NOT_SYNC_STATE_ERRORS.keys()]
    .filter((code) => !emitted.has(code))
    .sort();
  assert.deepEqual(stale, [], "excluded codes no longer emitted by the sync path");
  for (const reason of NOT_SYNC_STATE_ERRORS.values()) {
    assert.ok(reason.trim().length > 0);
  }
});
