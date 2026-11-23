import assert from "node:assert/strict";
import test from "node:test";
import { onboardingRedirectTarget } from "./onboarding-guard.ts";

const INTRO = { completed: false, socialAccountsCompleted: false };
const SOCIAL_DUE = { completed: true, socialAccountsCompleted: false };
const DONE = { completed: true, socialAccountsCompleted: true };

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
    assert.notEqual(onboardingRedirectTarget("/account/profile", status), null);
  }
  assert.equal(onboardingRedirectTarget("/account/facebook", INTRO), "/setup");
});
