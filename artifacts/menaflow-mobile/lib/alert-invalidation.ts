/**
 * Maps an arriving push alert onto the cached queries it makes stale.
 *
 * The alert is the event; the cache is a snapshot taken before it. Without this,
 * a notification tells the merchant something happened and then shows them a
 * screen that has not heard about it yet — the banner says "a customer is waiting
 * for your reply" above a conversation list that still looks empty until the next
 * timer tick. That gap is what makes long polling periods safe to use: freshness
 * for the four alertable events comes from the event, and the timer is only the
 * fallback for when push does not arrive at all.
 *
 * Invalidation is by key *prefix*, which is enough because every key in this app
 * starts with a stable name followed by the user id and then its parameters:
 * `["meta-inbox", userId]` for the list and
 * `["meta-inbox", userId, personId, platform]` for one conversation. Invalidating
 * `["meta-inbox"]` therefore refreshes the list and, if a thread is open, the
 * thread — which is exactly the pair a customer-message alert should refresh.
 *
 * Pure on purpose, like `alert-routes.ts`: no Expo and no React Native import, so
 * the mapping is testable in plain Node.
 */

/**
 * The event types the API server can send.
 *
 * Mirrors the `mena_push_notification_outbox_event_type_check` constraint. Kept
 * as a literal union rather than imported, because the mobile app must not depend
 * on server internals and the two are reconciled by the tests below.
 */
export type AlertEventType =
  | "customer_message"
  | "publish_failure"
  | "new_order"
  | "quota_exhausted";

/** A React Query key prefix: `["meta-inbox"]` matches every key starting with it. */
export type QueryKeyPrefix = readonly string[];

const PREFIXES_BY_EVENT_TYPE: Record<AlertEventType, readonly QueryKeyPrefix[]> =
  {
    /**
     * A customer wrote and nobody answered. Refreshes both inboxes because the
     * alert does not say which channel it came from once the payload has been
     * reduced to a route, and refreshing an unmounted query costs nothing — it is
     * only marked stale. The per-thread message query is included so an open
     * WhatsApp conversation shows the message that triggered the alert.
     */
    customer_message: [
      ["meta-inbox"],
      ["whatsapp-direct-inbox"],
      ["whatsapp-direct-messages"],
    ],

    /**
     * A publication failed. The job list carries the failure reason, and the
     * catalogue carries the product whose publication state the merchant will
     * look at next.
     */
    publish_failure: [["product-publication-jobs"], ["product-catalog"]],

    /** A draft order was created from a conversation. */
    new_order: [["orders"], ["order-summary"]],

    /**
     * Deliberately empty: no query in the mobile app caches subscription usage or
     * plan limits, so there is nothing to invalidate. The alert still navigates to
     * settings, which reads what it needs on mount. Adding a prefix here "just in
     * case" would invalidate an unrelated cache on every quota alert.
     */
    quota_exhausted: [],
  };

const KNOWN_EVENT_TYPES: readonly string[] = Object.keys(PREFIXES_BY_EVENT_TYPE);

/** Whether a payload's `eventType` is one this build knows how to react to. */
export function isKnownAlertEventType(value: unknown): value is AlertEventType {
  return typeof value === "string" && KNOWN_EVENT_TYPES.includes(value);
}

/**
 * The query key prefixes an alert makes stale.
 *
 * Returns an empty list for a payload with no `eventType`, a non-object payload,
 * or an event type this build does not know. Unknown means the server was
 * upgraded and the client was not, and the honest answer then is "invalidate
 * nothing" rather than guessing: this build has no screen for an event type it
 * cannot name, and a broad guess would refetch unrelated caches on every alert.
 * The caller logs what it dropped, the same way `routeFromAlertData` leaves an
 * out-of-allowlist route to be logged and ignored.
 */
export function queryPrefixesForAlertData(
  data: unknown,
): readonly QueryKeyPrefix[] {
  if (!data || typeof data !== "object") return [];
  const eventType = (data as Record<string, unknown>).eventType;
  if (!isKnownAlertEventType(eventType)) return [];
  return PREFIXES_BY_EVENT_TYPE[eventType];
}

/**
 * The event types this build recognises, for tests and diagnostics.
 *
 * Exposed rather than derived at each call site so a test can assert the mapping
 * covers every type the server may send, and so a future fifth type shows up as a
 * missing key instead of silently invalidating nothing.
 */
export const KNOWN_ALERT_EVENT_TYPES: readonly AlertEventType[] =
  KNOWN_EVENT_TYPES as readonly AlertEventType[];
