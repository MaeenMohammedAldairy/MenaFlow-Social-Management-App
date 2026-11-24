import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const {
  canRetryMetaAutoReply,
  describeMetaAutoReplyFailure,
  describeMetaAutoReplyPostponed,
  isMetaAutoReplyPostponedCode,
} = await import("./meta-auto-reply-failure.ts");

const here = path.dirname(fileURLToPath(import.meta.url));
const errorCodesSource = readFileSync(
  path.resolve(here, "../../api-server/src/lib/error-codes.ts"),
  "utf8",
);

/**
 * The server's list of limits that postpone a reply instead of ending it. Read
 * from the source rather than duplicated, so a new paused code fails the drift
 * gate below until the inbox has wording for it.
 */
function serverPausedCodes() {
  const block = errorCodesSource.match(
    /export const autoReplyGenerationPausedCodes = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(block, "autoReplyGenerationPausedCodes not found in error-codes.ts");
  return [...block[1].matchAll(/"([A-Z0-9_]+)"/g)].map((match) => match[1]);
}

test("every limit that postpones a reply has merchant wording", () => {
  const codes = serverPausedCodes();
  assert.ok(codes.length >= 7, codes);
  assert.ok(codes.includes("SUBSCRIPTION_LIMIT_REACHED"), codes);
  for (const code of codes) {
    const message = describeMetaAutoReplyPostponed(code);
    assert.ok(message, `${code} has no postponed copy`);
    assert.equal(isMetaAutoReplyPostponedCode(code), true, code);
    // The merchant can always act now; copy that only says "wait" is a dead end.
    assert.match(message, /يدويًا/, code);
    assert.match(message, /تلقائيًا/, code);
  }
});

test("a quota and a server misconfiguration are worded differently", () => {
  // The quota returns on its own at the next period; a missing provider key does
  // not, so promising "when the quota renews" for a configuration fault would be
  // a lie the merchant can disprove by waiting.
  const quota = describeMetaAutoReplyPostponed(
    "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
  );
  assert.match(quota, /حصة الذكاء الاصطناعي/);
  const configuration = describeMetaAutoReplyPostponed("MISSING_AI_PROVIDER_KEY");
  assert.match(configuration, /إعداد الذكاء الاصطناعي/);
  assert.doesNotMatch(configuration, /حصة/);
  assert.notEqual(quota, configuration);
});

test("codes stored before stable codes existed are still understood", () => {
  assert.equal(isMetaAutoReplyPostponedCode("SubscriptionAiQuotaError"), true);
  assert.match(
    describeMetaAutoReplyPostponed("SubscriptionAiQuotaError"),
    /حصة الذكاء الاصطناعي/,
  );
});

test("codes that are not limits produce no postponed wording", () => {
  for (const code of [
    "META_MESSAGE_WINDOW_EXPIRED",
    "META_COMMENT_WINDOW_EXPIRED",
    "AUTOMATION_DISABLED",
    "SUPERSEDED_BY_NEWER_MESSAGE",
    "AUTO_REPLY_LOOP_GUARD",
    "ITEM_ALREADY_REPLIED",
    "META_SEND_RESULT_UNKNOWN",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.equal(describeMetaAutoReplyPostponed(code), null, String(code));
    assert.equal(isMetaAutoReplyPostponedCode(code), false, String(code));
  }
});

test("a postponed job is not offered a retry it does not need", () => {
  // It is still queued and will run by itself; a retry button here would invite
  // the merchant to spend another attempt on a limit that has not moved.
  assert.equal(canRetryMetaAutoReply("queued"), false);
  assert.equal(canRetryMetaAutoReply("processing"), false);
  assert.equal(canRetryMetaAutoReply("skipped"), true);
  assert.equal(canRetryMetaAutoReply("failed"), true);
  assert.equal(canRetryMetaAutoReply("sent"), false);
});

test("terminal rows keep their own wording, distinct from the postponement", () => {
  // Jobs recorded before the queue could postpone are terminal: the honest
  // advice is a manual reply for that message, not "it will resume".
  const terminal = describeMetaAutoReplyFailure("SUBSCRIPTION_LIMIT_REACHED");
  assert.ok(terminal);
  assert.match(terminal, /يدويًا/);
  assert.notEqual(terminal, describeMetaAutoReplyPostponed("SUBSCRIPTION_LIMIT_REACHED"));
  assert.equal(
    describeMetaAutoReplyFailure("META_MESSAGE_WINDOW_EXPIRED") !== null ||
      describeMetaAutoReplyFailure("WINDOW_EXPIRED") !== null,
    true,
  );
});
