import assert from "node:assert/strict";
import test from "node:test";
import { onboardingRedirectTarget } from "./onboarding-guard.ts";

const INTRO = { completed: false, socialAccountsCompleted: false };
const SOCIAL_DUE = { completed: true, socialAccountsCompleted: false };
const DONE = { completed: true, socialAccountsCompleted: true };

test("before the slides are finished, only /onboarding is reachable", () => {
  assert.equal(onboardingRedirectTarget("/onboarding", INTRO), null);
  assert.equal(onboardingRedirectTarget("/", INTRO), "/onboarding");
  assert.equal(onboardingRedirectTarget("/more/sources", INTRO), "/onboarding");
});

test("once everything is done, nothing redirects", () => {
  for (const pathname of ["/", "/inbox/x", "/more/orders", "/connect-accounts"]) {
    assert.equal(onboardingRedirectTarget(pathname, DONE), null, pathname);
  }
});

test("the funnel screens stay reachable while a platform is still owed", () => {
  for (const pathname of [
    "/connect-accounts",
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

test("a trailing-slash path is not mistaken for the dashboard", () => {
  // The exact-match on "/" must not become a suffix match: "/inbox/" is not the
  // dashboard and must keep funnelling to connect-accounts.
  assert.equal(onboardingRedirectTarget("/inbox/", SOCIAL_DUE), "/connect-accounts");
  assert.equal(onboardingRedirectTarget("/more/", SOCIAL_DUE), "/connect-accounts");
});

test("anything else funnels to connect-accounts while a platform is owed", () => {
  for (const pathname of ["/inbox/x", "/more/orders", "/products", "/activities"]) {
    assert.equal(
      onboardingRedirectTarget(pathname, SOCIAL_DUE),
      "/connect-accounts",
      pathname,
    );
  }
});
