import assert from "node:assert/strict";
import test from "node:test";
import {
  clampInboundWebhookEventQueryLimit,
  DEFAULT_INBOUND_WEBHOOK_RECORD_INTERVAL_MS,
  INBOUND_WEBHOOK_THROTTLE_MAX_KEYS,
  inboundWebhookThrottleKey,
  MIN_INBOUND_WEBHOOK_RECORD_INTERVAL_MS,
  resolveInboundWebhookRecordIntervalMs,
  shouldRecordInboundWebhookAttempt,
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

test("the record interval defaults to a minute and is floored at a second", () => {
  assert.equal(DEFAULT_INBOUND_WEBHOOK_RECORD_INTERVAL_MS, 60_000);
  assert.equal(MIN_INBOUND_WEBHOOK_RECORD_INTERVAL_MS, 1_000);
  assert.equal(resolveInboundWebhookRecordIntervalMs({}), 60_000);
  assert.equal(
    resolveInboundWebhookRecordIntervalMs({ INBOUND_WEBHOOK_RECORD_INTERVAL_MS: "0" }),
    60_000,
  );
  assert.equal(
    resolveInboundWebhookRecordIntervalMs({ INBOUND_WEBHOOK_RECORD_INTERVAL_MS: "abc" }),
    60_000,
  );
  // A value below the floor is clamped, not defaulted: an operator who asks for
  // a tighter throttle gets the tightest one that still throttles.
  assert.equal(
    resolveInboundWebhookRecordIntervalMs({ INBOUND_WEBHOOK_RECORD_INTERVAL_MS: "10" }),
    1_000,
  );
  assert.equal(
    resolveInboundWebhookRecordIntervalMs({ INBOUND_WEBHOOK_RECORD_INTERVAL_MS: "5000" }),
    5_000,
  );
});

test("the throttle key separates instances, accounts and outcomes", () => {
  const base = {
    platform: "whatsapp",
    event: "WHATSAPP_WEBHOOK_IGNORED_EVENT",
    workspaceId: null,
    instanceName: "menaflow-3c247db8a54d",
    accountId: null,
  };
  assert.equal(
    inboundWebhookThrottleKey(base),
    "whatsapp|WHATSAPP_WEBHOOK_IGNORED_EVENT|-|menaflow-3c247db8a54d|-",
  );
  // Two instances ignoring the same event are two facts, not one.
  assert.notEqual(
    inboundWebhookThrottleKey({ ...base, instanceName: "other" }),
    inboundWebhookThrottleKey(base),
  );
  assert.notEqual(
    inboundWebhookThrottleKey({ ...base, event: "WHATSAPP_WEBHOOK_PROCESSED" }),
    inboundWebhookThrottleKey(base),
  );
  assert.notEqual(
    inboundWebhookThrottleKey({ ...base, platform: null, accountId: "100105546131276" }),
    inboundWebhookThrottleKey(base),
  );
});

test("an accepted outcome is written once per interval, not once per event", () => {
  const lastRecorded = new Map();
  const attempt = {
    rejection: false,
    key: "whatsapp|WHATSAPP_WEBHOOK_IGNORED_EVENT|-|inst|-",
    intervalMs: 60_000,
    lastRecorded,
  };
  assert.equal(shouldRecordInboundWebhookAttempt({ ...attempt, now: 1_000 }), true);
  assert.equal(shouldRecordInboundWebhookAttempt({ ...attempt, now: 2_000 }), false);
  assert.equal(shouldRecordInboundWebhookAttempt({ ...attempt, now: 60_999 }), false);
  assert.equal(shouldRecordInboundWebhookAttempt({ ...attempt, now: 61_000 }), true);
  assert.equal(lastRecorded.size, 1);
});

test("a refusal is always written, even inside the interval", () => {
  // A burst of refused calls is exactly when an operator needs every one: the
  // count of refusals is the evidence, and throttling it would understate a
  // misconfiguration that is rejecting hundreds of deliveries a minute.
  const lastRecorded = new Map();
  for (let index = 0; index < 50; index += 1) {
    assert.equal(
      shouldRecordInboundWebhookAttempt({
        rejection: true,
        key: "whatsapp|WHATSAPP_WEBHOOK_REJECTED_SECRET|-|inst|-",
        now: 1_000 + index,
        intervalMs: 60_000,
        lastRecorded,
      }),
      true,
      index,
    );
  }
});

test("different outcomes and instances do not share a throttle slot", () => {
  const lastRecorded = new Map();
  const first = shouldRecordInboundWebhookAttempt({
    rejection: false,
    key: inboundWebhookThrottleKey({
      platform: "whatsapp",
      event: "WHATSAPP_WEBHOOK_PROCESSED",
      instanceName: "a",
    }),
    now: 1_000,
    intervalMs: 60_000,
    lastRecorded,
  });
  const second = shouldRecordInboundWebhookAttempt({
    rejection: false,
    key: inboundWebhookThrottleKey({
      platform: "whatsapp",
      event: "WHATSAPP_WEBHOOK_PROCESSED",
      instanceName: "b",
    }),
    now: 1_001,
    intervalMs: 60_000,
    lastRecorded,
  });
  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(lastRecorded.size, 2);
});

test("the key map is bounded so a long-lived process cannot grow it forever", () => {
  const lastRecorded = new Map();
  for (let index = 0; index < INBOUND_WEBHOOK_THROTTLE_MAX_KEYS; index += 1) {
    shouldRecordInboundWebhookAttempt({
      rejection: false,
      key: `whatsapp|EVENT|ws-${index}|-|-`,
      now: index,
      intervalMs: 60_000,
      lastRecorded,
    });
  }
  assert.equal(lastRecorded.size, INBOUND_WEBHOOK_THROTTLE_MAX_KEYS);
  // One more key clears the map rather than growing it; the cost is that the
  // next attempt of each kind is recorded again, which is what a fresh process
  // does anyway.
  shouldRecordInboundWebhookAttempt({
    rejection: false,
    key: "whatsapp|EVENT|one-more|-|-",
    now: INBOUND_WEBHOOK_THROTTLE_MAX_KEYS + 1,
    intervalMs: 60_000,
    lastRecorded,
  });
  assert.equal(lastRecorded.size, 1);
});
