/**
 * Polling periods for cached server data.
 *
 * These were fifteen scattered numeric literals between 10 s and 45 min. They
 * live here because the right value is a property of *what the data is*, not of
 * the screen that happens to render it, and because the trade-off is only
 * visible when the numbers sit next to each other.
 *
 * Two things make long periods safe now that were not true before:
 *
 * 1. `lib/query-focus.ts` wires React Query's focus manager to the host app
 *    state. Until that existed, `focusManager.isFocused()` fell back to
 *    `globalThis.document?.visibilityState !== "hidden"`, which is permanently
 *    true in React Native because there is no `document`. The interval timer
 *    consults exactly that (query-core `queryObserver.js`: a tick only fetches
 *    when `refetchIntervalInBackground || focusManager.isFocused()`), so every
 *    poll kept running with the app backgrounded — the 10–15 s periods were
 *    never actually paused. It also means `refetchOnWindowFocus: true`, set at
 *    thirteen places, was inert: no focus change was ever reported, so returning
 *    to the app refetched nothing. Both now work, which is what pays for the
 *    longer periods: data refreshes when the merchant looks at it, instead of on
 *    a timer whether or not anybody is looking.
 *
 * 2. Push notifications (§4.8) invalidate the relevant queries when an alert
 *    arrives — see `lib/alert-invalidation.ts`. Freshness for the four alertable
 *    events is now event-driven, and polling is the fallback for when push is
 *    not delivered: web, an iOS build without `mode: "production"`, a token not
 *    yet registered, or a merchant who declined the permission.
 *
 * Polling is *not* redundant for an open conversation, and this is measured
 * rather than assumed: the server de-duplicates customer-message alerts to one
 * per conversation per hour (`notification-content.ts`, dedupe key
 * `<conversation>:<hourBucket>`). The second and later messages inside that hour
 * produce no alert at all, so for a thread a merchant is actively reading the
 * timer is the only mechanism that will show them.
 */

/**
 * A single conversation the merchant is reading right now.
 *
 * At most one such query is mounted at a time, and this is the one screen where
 * staleness is both directly visible and directly costly — a customer is waiting
 * on a reply. Halved from 15 s / 10 s rather than pushed out to minutes, for the
 * de-duplication reason above.
 */
export const POLL_ACTIVE_CONVERSATION_MS = 30_000;

/**
 * Lists a merchant browses: inbox conversations, product-extraction suggestions.
 *
 * Changed unconditionally every 10–15 s before. Two minutes is well inside what
 * a browsing reader notices, especially now that a push arrival and a return to
 * the app both refresh immediately.
 */
export const POLL_LIST_MS = 120_000;

/**
 * Aggregate counts and badges: the order summary behind the header bell and the
 * order-summary totals on the home tab. Both are a single number a merchant
 * glances at, not a list they read line by line.
 *
 * A badge that is five minutes stale costs nothing; polling it every 15 s costs
 * a request per screen per interval forever, including in the background. The
 * in-flight sync indicator is deliberately *not* here — it is one of the
 * conditional periods described at the bottom of this file, polling only while a
 * sync actually runs.
 */
export const POLL_AGGREGATE_MS = 300_000;

/**
 * Deliberately absent from this module: the periods for work the client can see
 * is in flight. Those stay where they are, because they are already conditional
 * and already correct — publication jobs poll every 2 s only while
 * `summary.inProgress`, an order confirmation every 5 s only while a
 * confirmation is queued/processing/sending, a WhatsApp connection every 3 s
 * only while `connecting`, and a running sync every 15 s. Each stops by
 * returning `false` once the work settles, so none of them is a standing cost,
 * and centralising a number whose whole point is "only while this is true" would
 * hide the condition that makes it safe.
 */
