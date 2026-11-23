import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ALLOWED_ALERT_ROUTES, routeFromAlertData } from "./alert-routes.ts";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app");

test("every allowed route exists in the app's router", () => {
  // Kept in sync by hand with the app/ directory; the server sends exactly these
  // four static routes, so a typo here would strand every alert on a dead screen.
  for (const route of ALLOWED_ALERT_ROUTES) {
    const asFile = join(appDir, `${route}.tsx`);
    const asDir = join(appDir, route, "index.tsx");
    assert.ok(existsSync(asFile) || existsSync(asDir), `المسار غير موجود: ${route}`);
  }
});

test("static routes are accepted verbatim", () => {
  for (const route of ALLOWED_ALERT_ROUTES) {
    assert.deepEqual(routeFromAlertData({ route }), { route });
  }
});

test("a Meta conversation route is accepted with or without its platform", () => {
  assert.deepEqual(routeFromAlertData({ route: "/inbox/person-7?platform=instagram" }), {
    route: "/inbox/person-7?platform=instagram",
  });
  assert.deepEqual(routeFromAlertData({ route: "/inbox/person-7?platform=facebook" }), {
    route: "/inbox/person-7?platform=facebook",
  });
  assert.deepEqual(routeFromAlertData({ route: "/inbox/person-7" }), {
    route: "/inbox/person-7",
  });
});

test("routes outside the allowlist are refused, not opened", () => {
  const refused = [
    // Unknown screens
    "/admin",
    "/",
    "/(auth)/sign-in",
    // Path traversal through the dynamic segment
    "/inbox/../../more/settings",
    "/inbox/..%2f..%2fmore/settings",
    // A second query string or a fragment smuggled in
    "/inbox/person-7?platform=instagram&evil=1",
    "/inbox/person-7#fragment",
    "/inbox/person-7?platform=whatsapp",
    // Backslashes in the conversation id
    "/inbox/per\\son",
  ];

  for (const route of refused) {
    assert.equal(routeFromAlertData({ route }), null, route);
  }
});

test("malformed payloads are refused instead of crashing", () => {
  const malformed = [null, undefined, 42, "string", [], {}, { route: null }, { route: 7 }, { route: "   " }];
  for (const data of malformed) {
    assert.equal(routeFromAlertData(data), null, JSON.stringify(data));
  }
});
