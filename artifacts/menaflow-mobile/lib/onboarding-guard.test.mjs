import assert from "node:assert/strict";
import test from "node:test";
import { onboardingRedirectTarget } from "./onboarding-guard.ts";

const INTRO = { completed: false, socialAccountsCompleted: false };
const SOCIAL_DUE = { completed: true, socialAccountsCompleted: false };
const DONE = { completed: true, socialAccountsCompleted: true };

// The product's own screens. During the signup funnel these are walled off;
// once setup is completed they must all be reachable, connected platform or
// not.
const PRODUCT_SCREENS = [
  "/",
  "/products",
  "/content",
  "/inbox",
  "/more",
  "/compose",
  "/activities",
  "/more/orders",
  "/more/reports",
  "/more/settings",
  "/account/profile",
  "/inbox/x",
  "/inbox/whatsapp",
];

test("before the concise setup is finished, only /setup is reachable", () => {
  assert.equal(onboardingRedirectTarget("/setup", INTRO), null);
  assert.equal(onboardingRedirectTarget("/", INTRO), "/setup");
  assert.equal(onboardingRedirectTarget("/more/sources", INTRO), "/setup");
});

test("the intro stage matches /setup exactly, never by suffix", () => {
  // Regression guard: endsWith("/setup") would accept "/whatsapp-setup",
  // trapping a brand-new merchant on a sheet that presupposes a connected
  // WhatsApp account.
  assert.equal(onboardingRedirectTarget("/whatsapp-setup", INTRO), "/setup");
});

test("once everything is done, nothing redirects", () => {
  for (const pathname of ["/", "/inbox/x", "/more/orders", "/connect-accounts"]) {
    assert.equal(onboardingRedirectTarget(pathname, DONE), null, pathname);
  }
});

test("the funnel screens stay reachable while a platform is still owed", () => {
  for (const pathname of [
    "/connect-accounts",
    "/setup",
    "/more/sources",
    "/more/accounts",
    "/more/channels",
    "/inbox/reply-settings",
    "/whatsapp-setup",
  ]) {
    assert.equal(
      onboardingRedirectTarget(pathname, SOCIAL_DUE),
      null,
      `كان يجب السماح بـ${pathname}`,
    );
  }
});

test("the dashboard is reachable while a platform is still owed (the skip button)", () => {
  // Regression: "أكمل لاحقًا" does router.replace("/(tabs)"), which resolves to
  // "/". While the dashboard was not allowed here, the guard redirected back and
  // the button read as dead.
  assert.equal(onboardingRedirectTarget("/", SOCIAL_DUE), null);
});

test("the whole product stays usable while a platform is still owed", () => {
  // Regression — reported as "anywhere I tap takes me to the connect-accounts
  // page". `socialAccountsCompleted` only flips true once a platform is really
  // connected (the server answers 409 otherwise), so walling the product on it
  // was not a transient nudge: it lasted until the merchant linked an account.
  // Four of the five tabs bounced, and so did /more/settings — which holds the
  // data export and the account-deletion request (§3.4).
  for (const pathname of PRODUCT_SCREENS) {
    assert.equal(
      onboardingRedirectTarget(pathname, SOCIAL_DUE),
      null,
      `لم يكن يجب تحويل ${pathname} إلى شاشة الربط`,
    );
  }
});

test("nothing is ever bounced to /connect-accounts once setup is completed", () => {
  // The redirect target no longer exists in the guard's vocabulary: deferring a
  // platform is guidance (dashboard checklist + hero CTA), not a gate.
  for (const status of [SOCIAL_DUE, DONE]) {
    for (const pathname of [...PRODUCT_SCREENS, "/connect-accounts", "/setup"]) {
      assert.notEqual(
        onboardingRedirectTarget(pathname, status),
        "/connect-accounts",
        pathname,
      );
    }
  }
});

test("the account linking subflow is reachable after the business step", () => {
  const inProgress = { ...INTRO, currentStep: 1 };
  for (const path of ["/setup", "/connect-accounts", "/whatsapp-setup", "/inbox/reply-settings"]) {
    assert.equal(onboardingRedirectTarget(path, inProgress), null, path);
  }
  assert.equal(onboardingRedirectTarget("/", inProgress), "/setup");
  assert.equal(onboardingRedirectTarget("/inbox/x", inProgress), "/setup");
});

test("linked account details are reachable without opening unrelated account routes", () => {
  for (const status of [{ ...INTRO, currentStep: 1 }, SOCIAL_DUE]) {
    for (const platform of ["facebook", "instagram", "whatsapp"]) {
      assert.equal(onboardingRedirectTarget(`/account/${platform}`, status), null);
    }
  }
  // During the funnel the product screens (including the profile) still lead
  // back to /setup; once setup is completed they are free.
  assert.equal(
    onboardingRedirectTarget("/account/profile", { ...INTRO, currentStep: 1 }),
    "/setup",
  );
  assert.equal(onboardingRedirectTarget("/account/profile", SOCIAL_DUE), null);
  assert.equal(onboardingRedirectTarget("/account/facebook", INTRO), "/setup");
});

test("a trailing-slash path is not mistaken for the dashboard during the funnel", () => {
  // The exact-match on "/" must not become a suffix match: "/inbox/" is not the
  // dashboard, so during the funnel it goes back to /setup like any other
  // product screen.
  const inProgress = { ...INTRO, currentStep: 1 };
  assert.equal(onboardingRedirectTarget("/inbox/", inProgress), "/setup");
  assert.equal(onboardingRedirectTarget("/more/", inProgress), "/setup");
});
