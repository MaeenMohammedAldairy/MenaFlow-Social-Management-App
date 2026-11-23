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
 * - `completed === false` — the signup funnel, and the **only** wall left.
 *   `/setup` is always reachable. Once the business step is saved
 *   (`currentStep > 0`), account linking and its existing setup subflows are
 *   allowed too; everything else goes back to `/setup`. This wall is escapable
 *   by design: "ادخل لوحة التحكم" on `/setup` and "أكمل لاحقًا" on
 *   `/connect-accounts` both persist `skip`, which sets `completed`.
 * - `completed === true`, `socialAccountsCompleted === false` — the merchant
 *   deferred linking a platform. **No redirect at all.** That flag is a
 *   checklist item, not an access permission: the product works with zero
 *   connections (products, content, inbox, orders, settings all render empty
 *   states), and the dashboard already carries the guidance — the "خطوات البدء"
 *   checklist plus a hero CTA ("ابدأ من هنا · اربط حسابًا للنشر").
 *
 *   It used to funnel every non-allowlisted route to `/connect-accounts`, which
 *   left a merchant who skipped setup able to sit on the dashboard and nowhere
 *   else: all four other tabs, `/compose`, `/more/orders`, `/more/reports`,
 *   `/account/profile` and — sharpest of all — `/more/settings`, where the data
 *   export and the account-deletion request live (§3.4). Since
 *   `socialAccountsCompleted` only flips true once a platform is genuinely
 *   connected (the server answers 409 otherwise), that state was not transient:
 *   it lasted until the merchant linked an account. Reported as "anywhere I tap
 *   takes me to the connect-accounts page".
 *
 * Returns `null` when the current pathname is acceptable, i.e. no redirect.
 */

export type OnboardingRouteStatus = {
  completed: boolean;
  /**
   * Whether a platform has been linked. Read by the dashboard checklist and the
   * connect screen; deliberately *not* an access gate — see the stage-2 note
   * above.
   */
  socialAccountsCompleted: boolean;
  currentStep?: number;
};

export type OnboardingRedirect = "/setup";

/**
 * Screens a merchant may sit on during the signup funnel, once the business
 * step has been saved.
 *
 * These are the funnel's own screens — sources, publishing accounts, channels,
 * reply settings and the WhatsApp setup sheet — plus `/connect-accounts`
 * itself, so the funnel never redirects to itself, and `/setup`: the dashboard
 * checklist's "أكمل بيانات النشاط" step must stay reachable. Note
 * `/whatsapp-setup` also ends with "/setup", which is harmless here — it is
 * allowed anyway.
 */
const FUNNEL_SCREENS_DURING_SETUP: readonly string[] = [
  "/connect-accounts",
  "/setup",
  "/more/sources",
  "/more/accounts",
  "/more/channels",
  "/inbox/reply-settings",
  "/whatsapp-setup",
];

function isFunnelScreenDuringSetup(pathname: string): boolean {
  // The dashboard `"/"` (the `(tabs)` group index resolves to the root path) is
  // matched exactly: an `endsWith` on "/" would accept any trailing-slash path,
  // and during the funnel the dashboard is deliberately *not* reachable — the
  // merchant finishes or defers setup first.
  if (pathname === "/") return true;
  // Account cards open these exact detail routes during the funnel.
  if (/^\/account\/(facebook|instagram|whatsapp)$/.test(pathname)) return true;
  return FUNNEL_SCREENS_DURING_SETUP.some((allowed) =>
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
    if (pathname === "/setup") return null;
    // Account linking and its existing WhatsApp/reply-settings subflows are
    // reachable only once business information has been saved.
    if (
      (status.currentStep ?? 0) > 0 &&
      isFunnelScreenDuringSetup(pathname) &&
      pathname !== "/"
    ) {
      return null;
    }
    return "/setup";
  }
  // Setup is completed. Whatever is still owed (a linked platform) is guidance,
  // not a gate — see the stage-2 note in the header.
  return null;
}
