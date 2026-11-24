import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const { describeMetaSubscriptionFailure } = await import(
  "./meta-subscription-failure.ts"
);

const here = path.dirname(fileURLToPath(import.meta.url));
const subscriptionsSource = readFileSync(
  path.resolve(here, "../../api-server/src/lib/meta-webhook-subscriptions.ts"),
  "utf8",
);

/**
 * Lowercase literals in the subscription module that are not failure codes:
 * platform names, webhook field names and Meta's own `error` key. A new
 * snake_case literal fails the drift gate below until it is classified here or
 * given merchant copy.
 */
const NOT_FAILURE_CODES = new Set([
  "facebook",
  "instagram",
  "messages",
  "messaging_postbacks",
  "comments",
  "feed",
  "error",
  "graph_",
]);

function recordedFailureCodes() {
  const codes = new Set();
  for (const match of subscriptionsSource.matchAll(/"([a-z][a-z0-9_]*)"/g)) {
    if (NOT_FAILURE_CODES.has(match[1])) continue;
    codes.add(match[1]);
  }
  return codes;
}

test("every recorded subscription failure has merchant copy", () => {
  const missing = [...recordedFailureCodes()]
    .filter((code) => describeMetaSubscriptionFailure(code)?.includes(`(${code})`))
    .sort();
  assert.deepEqual(missing, []);
});

test("known codes are explained without echoing the code", () => {
  for (const code of ["token_expired", "permissions_missing", "network_error"]) {
    const message = describeMetaSubscriptionFailure(code);
    assert.ok(message, code);
    assert.ok(!message.includes(code), message);
    assert.ok(message.length > 20, message);
  }
});

test("token_expiry copy points at re-linking the account", () => {
  const message = describeMetaSubscriptionFailure("token_expired");
  assert.ok(message?.includes("أعد ربط"), message);
});

test("a Graph refusal keeps its number, because Meta support asks for it", () => {
  const message = describeMetaSubscriptionFailure("graph_190");
  assert.ok(message?.includes("190"), message);
  assert.ok(message.includes("ميتا"), message);
});

test("an unknown code still says what to do next", () => {
  const message = describeMetaSubscriptionFailure("something_new");
  assert.ok(message?.includes("something_new"), message);
  assert.ok(message.includes("الدعم"), message);
});

test("empty input yields no message", () => {
  assert.equal(describeMetaSubscriptionFailure(null), null);
  assert.equal(describeMetaSubscriptionFailure("  "), null);
  assert.equal(describeMetaSubscriptionFailure(undefined), null);
});

test("the exclusion list stays honest", () => {
  const literals = new Set(
    [...subscriptionsSource.matchAll(/"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]),
  );
  const stale = [...NOT_FAILURE_CODES].filter((code) => !literals.has(code));
  // `graph_` is a prefix rather than a literal, so it is checked separately.
  assert.deepEqual(
    stale.filter((code) => code !== "graph_"),
    [],
  );
  assert.ok(subscriptionsSource.includes("`graph_"), "graph_ prefix disappeared");
});
