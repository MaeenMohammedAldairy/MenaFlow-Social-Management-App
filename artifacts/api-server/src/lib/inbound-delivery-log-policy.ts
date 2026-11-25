/**
 * inbound-delivery-log-policy.ts
 *
 * Tuning for the inbound delivery log: how long an attempt is kept and how many
 * rows a diagnostics read may pull.
 *
 * Split out from `inbound-delivery-log.ts` so the numbers are testable on their
 * own — that module imports the database, which the unit test runner cannot
 * resolve, and the retention window is exactly the kind of value a typo can
 * quietly turn into "delete the evidence".
 */

/**
 * How long an attempt stays in the log. Long enough to cover a merchant
 * checking in the evening about the morning's messages and short enough that
 * the table cannot grow without bound: one row per webhook call is a lot of
 * rows for a busy page.
 */
export const DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS =
  7 * 24 * 60 * 60 * 1000;
/** A window shorter than an hour cannot answer "did anything arrive today". */
export const MIN_INBOUND_WEBHOOK_EVENT_RETENTION_MS = 60 * 60 * 1000;

/** Rows read back for one workspace's diagnostics. */
export const DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT = 200;
export const MIN_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT = 1;
export const MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT = 1000;

/**
 * Unparseable or non-positive falls back to the default; a value that parses but
 * is merely too small or too large is clamped. An operator who asks for a
 * 30-day window should get the floor of what is safe, not a silent default that
 * contradicts the setting they just made.
 */
function positiveInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function resolveInboundWebhookEventRetentionMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveInteger(
    env.INBOUND_WEBHOOK_EVENT_RETENTION_MS,
    DEFAULT_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
    MIN_INBOUND_WEBHOOK_EVENT_RETENTION_MS,
  );
}

export function resolveInboundWebhookEventQueryLimit(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveInteger(
    env.INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
    DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
    MIN_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
    MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
}

/**
 * Applies the same bounds to a limit a caller passed in, so a per-request value
 * can never read more rows than the deployment allows.
 */
export function clampInboundWebhookEventQueryLimit(
  value: number | null | undefined,
): number {
  if (value === null || value === undefined) {
    return resolveInboundWebhookEventQueryLimit();
  }
  return positiveInteger(
    String(value),
    DEFAULT_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
    MIN_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
    MAX_INBOUND_WEBHOOK_EVENT_QUERY_LIMIT,
  );
}

/**
 * One row per outcome per key per interval, for outcomes that are not refusals.
 *
 * The log is written from the inbound webhook path, which is the hottest code in
 * the server: Evolution posts presence and connection updates continuously, and
 * a busy page produces a `PROCESSED` outcome per message. Recording every one of
 * those turns a diagnostics table into the largest writer in the system while
 * adding nothing a reader can act on — the hundredth identical "event ignored"
 * row says exactly what the first one did.
 *
 * Refusals are never throttled: they are the rare, load-bearing rows, and a
 * burst of refused calls is precisely the moment an operator needs every one.
 */
export const DEFAULT_INBOUND_WEBHOOK_RECORD_INTERVAL_MS = 60_000;
/** Below one second the throttle stops throttling and the volume returns. */
export const MIN_INBOUND_WEBHOOK_RECORD_INTERVAL_MS = 1_000;

/**
 * Keys held before the map is cleared. One key is a short string, so this caps
 * the throttle's memory at a few hundred kilobytes however many instances and
 * accounts a deployment serves.
 */
export const INBOUND_WEBHOOK_THROTTLE_MAX_KEYS = 5_000;

export function resolveInboundWebhookRecordIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveInteger(
    env.INBOUND_WEBHOOK_RECORD_INTERVAL_MS,
    DEFAULT_INBOUND_WEBHOOK_RECORD_INTERVAL_MS,
    MIN_INBOUND_WEBHOOK_RECORD_INTERVAL_MS,
  );
}

/**
 * Identity of "the same outcome happening again": one platform, one outcome, and
 * whichever identifier the attempt carried. Two instances ignoring presence
 * updates are two facts, not one, so the key keeps them apart.
 */
export function inboundWebhookThrottleKey(input: {
  platform: string | null;
  event: string;
  workspaceId?: string | null;
  instanceName?: string | null;
  accountId?: string | null;
}): string {
  return [
    input.platform ?? "-",
    input.event,
    input.workspaceId ?? "-",
    input.instanceName ?? "-",
    input.accountId ?? "-",
  ].join("|");
}

/**
 * True when this attempt should be written.
 *
 * `lastRecorded` is mutated on a decision to record, so the caller passes the
 * map it owns and the function stays free of module state — which is what makes
 * the interval testable without waiting for it.
 */
export function shouldRecordInboundWebhookAttempt(input: {
  /** True when the outcome is a refusal; refusals are always recorded. */
  rejection: boolean;
  key: string;
  now: number;
  intervalMs?: number;
  lastRecorded: Map<string, number>;
}): boolean {
  if (input.rejection) {
    input.lastRecorded.set(input.key, input.now);
    return true;
  }
  const interval = input.intervalMs ?? resolveInboundWebhookRecordIntervalMs();
  const previous = input.lastRecorded.get(input.key);
  if (previous !== undefined && input.now - previous < interval) {
    return false;
  }
  // Clearing rather than evicting keeps this O(1) on the hot path. Losing the
  // remembered timestamps only means the next attempt of each kind is recorded,
  // which is the behaviour a fresh process already has.
  if (input.lastRecorded.size >= INBOUND_WEBHOOK_THROTTLE_MAX_KEYS) {
    input.lastRecorded.clear();
  }
  input.lastRecorded.set(input.key, input.now);
  return true;
}
