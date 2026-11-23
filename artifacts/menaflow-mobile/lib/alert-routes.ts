/**
 * Validates the route a push notification asks the app to open.
 *
 * Kept free of expo imports so it can be tested in plain Node: the Expo modules
 * cannot be loaded by the test runner, and this is the one piece of the push
 * path worth unit-testing because getting it wrong is a security problem, not a
 * cosmetic one.
 */

/**
 * Routes an alert is allowed to open.
 *
 * Checked rather than trusted. Push payloads travel through Expo's service, and
 * a compromised or merely buggy sender should not be able to navigate a
 * merchant's app somewhere arbitrary — an unknown screen is harmless, but a
 * route carrying parameters is not. Anything outside this list is logged and
 * dropped, and the app simply opens normally.
 */
export const ALLOWED_ALERT_ROUTES: readonly string[] = [
  "/inbox/whatsapp",
  "/(tabs)/products",
  "/(tabs)/more/orders",
  "/(tabs)/more/settings",
];

/**
 * Resolves the route an alert should open, or null when it should not navigate.
 *
 * Meta conversation alerts carry `/inbox/<conversationId>?platform=<platform>`;
 * the conversation segment is validated rather than accepted blindly, so a
 * payload cannot smuggle a path traversal, a second query string or a fragment
 * through it.
 */
export function routeFromAlertData(data: unknown): { route: string } | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).route;
  if (typeof raw !== "string" || raw.trim() === "") return null;

  const route = raw.trim();
  if (ALLOWED_ALERT_ROUTES.includes(route)) return { route };

  // The one dynamic route: /inbox/<conversationId>[?platform=facebook|instagram]
  const match = /^\/inbox\/([^/?#]+)(\?platform=(facebook|instagram))?$/.exec(
    route,
  );
  if (match) {
    const conversationId = match[1];
    // Encoded separators would change what the route means, so they are refused.
    if (conversationId && !/[\\/]/.test(conversationId)) return { route };
  }

  return null;
}
