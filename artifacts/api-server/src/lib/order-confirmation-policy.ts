/**
 * The numbers and the one pure decision both order-confirmation queues share.
 *
 * `mena_orders` runs a confirmation state machine per channel family
 * (`whatsapp_confirmation_*` and `meta_confirmation_*`): `queued` → `processing`
 * under a lease → `sending` → `sent`, or `unknown` / `manual_followup` /
 * `failed`. Both families count attempts the same way and both stop at the same
 * ceiling; what differs is how long a lease runs before a dead worker's row is
 * reaped. Those values used to be three literals per queue file, with nothing
 * tying them to the database check that caps the counter. They live here, and
 * `order-confirmation-policy.test.mjs` ties the ceiling to that check.
 *
 * Pure and dependency-free, in the style of `auto-reply-policy.ts`.
 */

/**
 * Attempts before a confirmation stops retrying.
 *
 * `mena_orders_whatsapp_confirmation_attempts_check` caps the WhatsApp counter
 * at `BETWEEN 0 AND 3`; a higher value here would make the claim fail on the
 * check instead of marking the row exhausted.
 */
export const ORDER_CONFIRMATION_MAX_ATTEMPTS = 3;

/** WhatsApp sends through the Evolution API; a stale lease is reaped after a minute. */
export const WHATSAPP_CONFIRMATION_LEASE_MS = 60_000;

/** Meta's Graph call includes a token refresh; its lease runs ninety seconds. */
export const META_CONFIRMATION_LEASE_MS = 90_000;

/** A row that has used every attempt ends in the queue's terminal status instead of being claimed again. */
export function confirmationAttemptsExhausted(attempts: number): boolean {
  return attempts >= ORDER_CONFIRMATION_MAX_ATTEMPTS;
}
