import assert from "node:assert/strict";
import test from "node:test";
import {
  clampInboundWebhookEventQueryLimit,
  DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
  MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  MIN_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  MIN_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
  resolveInboundWebhookEventQueryLimit,
  resolveInboundWebhookEventRetentionMs,
} from "./inbound-delivery-log-policy.ts";

test("the retention window defaults to seven days", () => {
  assert.equal(DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(resolveInboundWebhookEventRetentionMs({}), DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS);
  assert.equal(
    resolveInboundWebhookEventRetentionMs({
      INBOUND_WEBHOOK_EVENT_RETENTION_MS: "",
    }),
    DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
  );
});

test("an unparseable or non-positive retention falls back to the default", () => {
  // A typo in an operational variable must not silently shorten the window to
  // nothing, which would delete the evidence the diagnostics screen needs.
  for (const raw of ["abc", "7d", "0", "-1", "NaN", "  "]) {
    assert.equal(
      resolveInboundWebhookEventRetentionMs({
        INBOUND_WEBHOOK_EVENT_RETENTION_MS: raw,
      }),
      DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
      raw,
    );
  }
});

test("a parsed retention value is clamped to the one-hour floor", () => {
  assert.equal(MIN_INBOUND_WEBHOOK_EVENT_RETENTION_MS, 60 * 60 * 1000);
  assert.equal(
    resolveInboundWebhookEventRetentionMs({
      INBOUND_WEBHOOK_EVENT_RETENTION_MS: "60000",
    }),
    MIN_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
  );
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  assert.equal(
    resolveInboundWebhookEventRetentionMs({
      INBOUND_WEBHOOK_EVENT_RETENTION_MS: String(thirtyDays),
    }),
    thirtyDays,
  );
});

test("the query limit defaults to 200 rows and clamps both ends", () => {
  assert.equal(DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT, 200);
  assert.equal(resolveInboundWebhookEventQueryLimit({}), 200);
  assert.equal(MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT, 1000);
  assert.equal(MIN_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT, 1);
  assert.equal(
    resolveInboundWebhookEventQueryLimit({
      INBOUND_WEBHOOK_EVENT_QUERY_LIMIT: "50000",
    }),
    MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
  assert.equal(
    resolveInboundWebhookEventQueryLimit({
      INBOUND_WEBHOOK_EVENT_QUERY_LIMIT: "50",
    }),
    50,
  );
});

test("an unusable query limit falls back rather than reading every row", () => {
  for (const raw of ["", "abc", "0", "-10"]) {
    assert.equal(
      resolveInboundWebhookEventQueryLimit({
        INBOUND_WEBHOOK_EVENT_QUERY_LIMIT: raw,
      }),
      DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
      raw,
    );
  }
  // A fractional limit is truncated, never rounded up past the caller's intent.
  assert.equal(
    resolveInboundWebhookEventQueryLimit({
      INBOUND_WEBHOOK_EVENT_QUERY_LIMIT: "3.9",
    }),
    3,
  );
});

test("a caller-supplied limit is bounded the same way as the environment", () => {
  // A per-request value must never read more rows than the deployment allows,
  // and an absent value falls back to the configured default.
  assert.equal(
    clampInboundWebhookEventQueryLimit(undefined),
    DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
  assert.equal(clampInboundWebhookEventQueryLimit(null), 200);
  assert.equal(clampInboundWebhookEventQueryLimit(50), 50);
  assert.equal(
    clampInboundWebhookEventQueryLimit(99999),
    MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
  assert.equal(
    clampInboundWebhookEventQueryLimit(0),
    DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
  assert.equal(
    clampInboundWebhookEventQueryLimit(-5),
    DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
  assert.equal(clampInboundWebhookEventQueryLimit(Number.NaN), 200);
});
