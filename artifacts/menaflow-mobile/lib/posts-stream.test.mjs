import assert from "node:assert/strict";
import test from "node:test";
import {
  STREAM_RETRY_BASE_MS,
  STREAM_RETRY_MAX_MS,
  isRetriableStreamStatus,
  streamReconnectDelayMs,
  streamReconnectPlan,
  streamStopReason,
} from "./posts-stream.ts";

const noJitter = () => 0;
const maxJitter = () => 1;

test("the backoff doubles from the server's own retry hint and stops at the ceiling", () => {
  assert.equal(streamReconnectDelayMs(0, noJitter), STREAM_RETRY_BASE_MS);
  assert.equal(streamReconnectDelayMs(1, noJitter), 10_000);
  assert.equal(streamReconnectDelayMs(2, noJitter), 20_000);
  assert.equal(streamReconnectDelayMs(3, noJitter), 40_000);
  assert.equal(streamReconnectDelayMs(4, noJitter), STREAM_RETRY_MAX_MS);
  // The schedule must not keep growing past the ceiling: the stream exists so that
  // posts do not have to be polled, and a retry every five minutes is a poll.
  assert.equal(streamReconnectDelayMs(12, noJitter), STREAM_RETRY_MAX_MS);
  assert.equal(streamReconnectDelayMs(500, noJitter), STREAM_RETRY_MAX_MS);
});

test("jitter is bounded and spreads a fleet that lost the same server", () => {
  assert.equal(streamReconnectDelayMs(0, maxJitter), 6_000);
  assert.equal(streamReconnectDelayMs(0, () => 0.5), 5_500);
  assert.equal(streamReconnectDelayMs(4, maxJitter), 72_000);

  const spread = new Set(
    Array.from({ length: 20 }, (_, index) => streamReconnectDelayMs(2, () => index / 20)),
  );
  assert.ok(spread.size > 15, "jitter produced almost identical delays");
});

test("an out-of-range attempt or randomness value cannot produce a nonsense delay", () => {
  assert.equal(streamReconnectDelayMs(-3, noJitter), STREAM_RETRY_BASE_MS);
  assert.equal(streamReconnectDelayMs(Number.NaN, noJitter), STREAM_RETRY_BASE_MS);
  assert.equal(streamReconnectDelayMs(1.7, noJitter), 10_000, "a fractional attempt floors");
  // A host random source outside [0,1) is clamped rather than multiplied through.
  assert.equal(streamReconnectDelayMs(0, () => -5), STREAM_RETRY_BASE_MS);
  assert.equal(streamReconnectDelayMs(0, () => 99), 6_000);
});

test("anything transient is worth retrying, and a refusal is not", () => {
  assert.equal(isRetriableStreamStatus(null), true, "no response at all is transient");
  assert.equal(isRetriableStreamStatus(200), true, "a stream that ended cleanly reopens");
  assert.equal(isRetriableStreamStatus(408), true);
  assert.equal(isRetriableStreamStatus(429), true, "the server asked for a later attempt");
  assert.equal(isRetriableStreamStatus(500), true);
  assert.equal(isRetriableStreamStatus(502), true);
  assert.equal(isRetriableStreamStatus(503), true);

  assert.equal(isRetriableStreamStatus(401), false);
  assert.equal(isRetriableStreamStatus(403), false);
  assert.equal(isRetriableStreamStatus(404), false);
  assert.equal(isRetriableStreamStatus(422), false);
});

test("the stop reason separates a session problem from a wrong request", () => {
  assert.equal(streamStopReason(401), "auth");
  assert.equal(streamStopReason(403), "auth");
  assert.equal(streamStopReason(404), "client");
  assert.equal(streamStopReason(422), "client");
  assert.equal(streamStopReason(429), null);
  assert.equal(streamStopReason(503), null);
  assert.equal(streamStopReason(null), null);
});

test("a refused session parks the stream instead of retrying it forever", () => {
  // This is the regression the policy exists for: the previous client reconnected
  // every five seconds with no ceiling and no distinction, so an expired session
  // or a rate-limited client produced twelve doomed requests a minute per open
  // tab, each one passing through the /api rate limiter.
  assert.deepEqual(streamReconnectPlan({ status: 401, attempt: 0 }), {
    kind: "stop",
    reason: "auth",
  });
  assert.deepEqual(streamReconnectPlan({ status: 403, attempt: 7 }), {
    kind: "stop",
    reason: "auth",
  });
  assert.deepEqual(streamReconnectPlan({ status: 404, attempt: 0 }), {
    kind: "stop",
    reason: "client",
  });
});

test("a transient failure retries on the backed-off schedule", () => {
  assert.deepEqual(streamReconnectPlan({ status: null, attempt: 0, random: noJitter }), {
    kind: "retry",
    delayMs: 5_000,
  });
  assert.deepEqual(streamReconnectPlan({ status: 503, attempt: 1, random: noJitter }), {
    kind: "retry",
    delayMs: 10_000,
  });
  assert.deepEqual(streamReconnectPlan({ status: 429, attempt: 9, random: noJitter }), {
    kind: "retry",
    delayMs: STREAM_RETRY_MAX_MS,
  });
  // A stream that was accepted and then ended reopens promptly, because the
  // caller resets the attempt count when a connection succeeds.
  assert.deepEqual(streamReconnectPlan({ status: 200, attempt: 0, random: noJitter }), {
    kind: "retry",
    delayMs: 5_000,
  });
});
