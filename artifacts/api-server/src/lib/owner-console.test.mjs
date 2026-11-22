import assert from "node:assert/strict";
import test from "node:test";
import {
  bearerToken,
  clampOwnerLimit,
  matchesOwnerConsoleToken,
  ownerConsoleMode,
  ownerConsoleTokens,
  ownerUsagePeriodKey,
  ownerUserIds,
  parseOwnerWindow,
  resolveOwnerConsoleAccess,
} from "./owner-console.ts";

const longToken = "t".repeat(32);
const otherToken = "u".repeat(32);

test("the console stays disabled until one access method is configured", () => {
  assert.equal(ownerConsoleMode({}), "disabled");
  assert.equal(
    ownerConsoleMode({ NODE_ENV: "production", MENA_OWNER_EMAIL: "a@b.c" }),
    "disabled",
  );
  assert.equal(
    ownerConsoleMode({
      NODE_ENV: "development",
      MENA_AUTH_DISABLED: "true",
      MENA_OWNER_EMAIL: "owner@example.com",
    }),
    "dev",
  );
  assert.equal(ownerConsoleMode({ MENA_OWNER_USER_IDS: "user_1" }), "clerk");
  assert.equal(
    ownerConsoleMode({ MENA_OWNER_CONSOLE_TOKEN: longToken }),
    "token",
  );
});

test("short console tokens are ignored so a weak secret cannot enable access", () => {
  assert.deepEqual(ownerConsoleTokens({ MENA_OWNER_CONSOLE_TOKEN: "short" }), []);
  assert.deepEqual(
    ownerConsoleTokens({ MENA_OWNER_CONSOLE_TOKEN: `${longToken}, ${otherToken}` }),
    [longToken, otherToken],
  );
});

test("console tokens are compared exactly and rotation lists keep working", () => {
  assert.equal(matchesOwnerConsoleToken(longToken, [longToken]), true);
  assert.equal(matchesOwnerConsoleToken(otherToken, [longToken, otherToken]), true);
  assert.equal(matchesOwnerConsoleToken("wrong".padEnd(32, "x"), [longToken]), false);
  assert.equal(matchesOwnerConsoleToken("", [longToken]), false);
  assert.equal(matchesOwnerConsoleToken(longToken, []), false);
});

test("bearer parsing only accepts a bearer scheme", () => {
  assert.equal(bearerToken(undefined), null);
  assert.equal(bearerToken("Basic abc"), null);
  assert.equal(bearerToken("Bearer   secret-token  "), "secret-token");
});

test("access resolves for the token, for an allowlisted clerk user, or not at all", () => {
  const env = {
    NODE_ENV: "production",
    MENA_OWNER_CONSOLE_TOKEN: longToken,
    MENA_OWNER_USER_IDS: "user_owner, user_second",
  };

  assert.deepEqual(
    resolveOwnerConsoleAccess({
      userId: null,
      authorization: `Bearer ${longToken}`,
      env,
    }),
    { allowed: true, mode: "token", reason: "ok", userId: null },
  );

  assert.deepEqual(
    resolveOwnerConsoleAccess({
      userId: "user_second",
      authorization: undefined,
      env,
    }),
    { allowed: true, mode: "token", reason: "ok", userId: "user_second" },
  );

  assert.equal(
    resolveOwnerConsoleAccess({
      userId: "user_customer",
      authorization: "Bearer nope",
      env,
    }).allowed,
    false,
  );
  assert.equal(
    resolveOwnerConsoleAccess({ userId: null, authorization: undefined, env })
      .reason,
    "missing",
  );
  assert.deepEqual(
    resolveOwnerConsoleAccess({
      userId: "user_owner",
      authorization: undefined,
      env: { NODE_ENV: "production", MENA_OWNER_USER_IDS: "user_owner" },
    }),
    { allowed: true, mode: "clerk", reason: "ok", userId: "user_owner" },
  );
  assert.equal(
    resolveOwnerConsoleAccess({
      userId: "user_customer",
      authorization: undefined,
      env: { NODE_ENV: "production", MENA_OWNER_USER_IDS: "user_owner" },
    }).allowed,
    false,
  );
  assert.equal(
    resolveOwnerConsoleAccess({ userId: null, authorization: undefined, env: {} })
      .mode,
    "disabled",
  );
});

test("owner allowlist tolerates spaces and empty entries", () => {
  assert.deepEqual(
    ownerUserIds({ MENA_OWNER_USER_IDS: " user_a , ,user_b " }),
    ["user_a", "user_b"],
  );
});

test("reporting windows fall back to 24 hours and clamp the rest", () => {
  const fallback = parseOwnerWindow(undefined);
  assert.equal(fallback.key, "24h");
  assert.equal(fallback.hours, 24);
  assert.ok(fallback.since instanceof Date);

  assert.equal(parseOwnerWindow("7d").hours, 168);
  assert.equal(parseOwnerWindow("30d").hours, 720);
  assert.equal(parseOwnerWindow("all").key, "24h");

  assert.equal(clampOwnerLimit(undefined), 25);
  assert.equal(clampOwnerLimit("10"), 10);
  assert.equal(clampOwnerLimit("0"), 25);
  assert.equal(clampOwnerLimit("500"), 100);
});

test("the usage period key matches the subscription usage table", () => {
  assert.equal(ownerUsagePeriodKey(new Date("2026-01-09T10:00:00Z")), "2026-01");
  assert.equal(ownerUsagePeriodKey(new Date("2026-12-31T23:00:00Z")), "2026-12");
});
