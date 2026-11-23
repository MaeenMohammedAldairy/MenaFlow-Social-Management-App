/**
 * Decides where the root layout should bounce a signed-in merchant during the
 * onboarding funnel.
 *
 * Pure on purpose — no Expo import — so the funnel is testable in plain Node.
 * The rules themselves live in `app/_layout.tsx`'s root effect; this module is
 * the same rules as a function, because a guard that silently swallows a tap is
 * exactly the kind of thing that needs a test: the "أكمل لاحقًا" button on the
 * social-setup screen navigates to the dashboard, and until the dashboard was in
 * the allowlist below, the guard redirected straight back, so the button looked
 * dead while every layer under it worked.
 *
 * The two stages, mirroring the server's onboarding progress:
 *
 * - `completed === false`: the concise setup (business name/type, then the
 *   optional channel hand-off) has not been finished. Only `/setup` itself is
 *   reachable; everything else is sent back to it.
 * - `completed === true`, `socialAccountsCompleted === false`: the merchant still
 *   owes one connected platform. The funnel screens stay reachable, and so does
 *   the dashboard — "أكمل لاحقًا" means exactly that, and the tab layout already
 *   degrades gracefully for this state by hiding the tab bar until a platform is
 *   connected (`app/(tabs)/_layout.tsx`). Everything else is sent to
 *   `/connect-accounts`.
 *
 * Returns `null` when the current pathname is acceptable, i.e. no redirect.
 */

export type OnboardingRouteStatus = {
  completed: boolean;
  socialAccountsCompleted: boolean;
};

export type OnboardingRedirect = "/setup" | "/connect-accounts";

/**
 * Screens a merchant may sit on while they still owe a connected platform.
 *
 * The dashboard `"/"` (the `(tabs)` group index resolves to the root path) is
 * matched separately and exactly, so "أكمل لاحقًا" works: deferring social setup
 * lands on the dashboard, which shows the setup prompt and hides the tab bar
 * until a platform is connected. The list below holds the funnel's own screens —
 * sources, publishing accounts, channels, reply settings and the WhatsApp setup
 * sheet — plus `/connect-accounts` itself, so the funnel never redirects to
 * itself, and `/setup`: the dashboard checklist's "أكمل بيانات النشاط" step must
 * stay reachable while a platform is still owed. Note `/whatsapp-setup` also
 * ends with "/setup", which is harmless here — it is allowed anyway.
 */
const ALLOWED_DURING_SOCIAL_SETUP: readonly string[] = [
  "/connect-accounts",
  "/setup",
  "/more/sources",
  "/more/accounts",
  "/more/channels",
  "/inbox/reply-settings",
  "/whatsapp-setup",
];

function isAllowedDuringSocialSetup(pathname: string): boolean {
  // The dashboard is matched exactly: an `endsWith` on "/" would accept any
  // trailing-slash path, which is not a route this app serves.
  if (pathname === "/") return true;
  return ALLOWED_DURING_SOCIAL_SETUP.some((allowed) =>
    pathname.endsWith(allowed),
  );
}

export function onboardingRedirectTarget(
  pathname: string,
  status: OnboardingRouteStatus,
): OnboardingRedirect | null {
  if (!status.completed) {
    // Exact match on purpose: endsWith("/setup") would also accept
    // "/whatsapp-setup", trapping the user on a sheet they cannot complete
    // before the concise setup itself is done.
    return pathname === "/setup" ? null : "/setup";
  }
  if (status.socialAccountsCompleted) return null;
  return isAllowedDuringSocialSetup(pathname) ? null : "/connect-accounts";
}
