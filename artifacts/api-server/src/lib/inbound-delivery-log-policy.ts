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

