/**
 * Reconnection policy for the post-change event stream (`GET /api/posts/events`).
 *
 * The stream is what keeps the dashboard's post list, its hero ("a post failed to
 * publish") and the header bell current without polling. It is also a long-lived
 * request, so the way it fails matters more than the way it succeeds.
 *
 * Before this module existed the client reconnected on a fixed five-second timer
 * with no backoff, no ceiling and no distinction between failure kinds: an API
 * that was down, or that had just refused the session, was retried twelve times a
 * minute per open web tab, forever, every attempt passing through the `/api` rate
 * limiter. A 401 in particular cannot be fixed by retrying — the merchant has to
 * re-authenticate — so retrying it only burns the rate-limit budget the rest of
 * the app needs.
 *
 * Pure on purpose, like `lib/query-focus.ts` and `lib/onboarding-guard.ts`: no
 * React Native, no `fetch`, and the jitter takes its randomness as a parameter so
 * the backoff schedule is assertable in plain Node.
 */

/** First retry delay. Matches the `retry: 5000` the server sends in the stream. */
export const STREAM_RETRY_BASE_MS = 5_000;

/**
 * Ceiling for the backoff.
 *
 * One minute is the point past which a retry stops being a reconnection and
 * starts being a poll the merchant did not ask for; the stream exists precisely so
 * that posts do not have to be polled.
 */
export const STREAM_RETRY_MAX_MS = 60_000;

/**
 * Why a stream should not be reopened by the timer at all.
 *
 * - `auth`: the server refused the session (401/403). Retrying cannot help; the
 *   root layout already shows the session banner, and the stream is reopened when
 *   the app returns to the foreground or the session changes.
 * - `client`: any other 4xx except 408 and 429. The request itself is wrong —
 *   the endpoint is gone, or the workspace header is not acceptable — and sending
 *   the same request again produces the same refusal.
 */
export type StreamStopReason = "auth" | "client";

export type StreamReconnectPlan =
  | { kind: "retry"; delayMs: number }
  | { kind: "stop"; reason: StreamStopReason };

/**
 * Whether an HTTP status is worth retrying.
 *
 * `null` stands for "no response at all" — a connection that never completed, a
 * DNS failure, a dropped socket, or a stream that ended cleanly after being open.
 * All of those are transient by definition, so they retry. 408 (request timeout)
 * and 429 (rate limited) retry too: both are the server asking for a later
 * attempt, which is exactly what the backoff does.
 */
export function isRetriableStreamStatus(status: number | null): boolean {
  if (status === null) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

/** The stop reason for a status that should not be retried, or `null`. */
export function streamStopReason(status: number | null): StreamStopReason | null {
  if (status === null) return null;
  if (status === 401 || status === 403) return "auth";
  return isRetriableStreamStatus(status) ? null : "client";
}

/**
 * Delay before retry `attempt` (zero-based), with up to 20% jitter.
 *
 * 5s, 10s, 20s, 40s, then the 60s ceiling. The jitter keeps a fleet of tabs that
 * lost the same server from reconnecting in lockstep on the same tick.
 */
export function streamReconnectDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  const exponential = Math.min(
    STREAM_RETRY_BASE_MS * 2 ** safeAttempt,
    STREAM_RETRY_MAX_MS,
  );
  const jitter = Math.min(Math.max(random(), 0), 1) * 0.2 * exponential;
  return Math.round(exponential + jitter);
}

/** What to do after a stream attempt failed with `status`, on attempt `attempt`. */
export function streamReconnectPlan(input: {
  status: number | null;
  attempt: number;
  random?: () => number;
}): StreamReconnectPlan {
  const reason = streamStopReason(input.status);
  if (reason) return { kind: "stop", reason };
  return {
    kind: "retry",
    delayMs: streamReconnectDelayMs(input.attempt, input.random),
  };
}
