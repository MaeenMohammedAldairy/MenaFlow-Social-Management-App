import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Static guard: every HTTP route must either run through `requireWorkspace` or
 * be listed below with the protection it uses instead.
 *
 * Why a *static* guard rather than only per-route tests: tenant isolation in
 * this codebase lives in one place — `requireWorkspace` resolves the caller's
 * workspace and `assertPostWorkspace`-style checks reject foreign records — and
 * the database offers no second layer (RLS is enabled on all 42 tables but has
 * zero policies, and the server connects as the table owner, so it bypasses
 * RLS). A single new route registered without the middleware is therefore a
 * cross-tenant data leak, and nothing else in CI would notice: 43 of the 44
 * route files have no test of their own, and two thirds of the paths are not in
 * the OpenAPI contract either.
 *
 * The scan fails closed in both directions — an unguarded route fails, and a
 * stale allowlist entry fails — so the list cannot rot into "everything is
 * exempt".
 */

const ROUTES_DIR = path.dirname(new URL(import.meta.url).pathname);

/**
 * Routes that legitimately do not use `requireWorkspace`, keyed by
 * `<file> <METHOD> <path>`, each with the protection that applies instead.
 */
const EXEMPT = new Map([
  // Liveness/readiness probes must answer with no session at all.
  ["health.ts GET /healthz", "public probe: no data, used by the platform's health check"],
  ["health.ts GET /readyz", "public probe: reports dependency readiness without tenant data"],

  // Webhooks are machine callers: authenticated by signature/secret, and there
  // is no signed-in user whose workspace could be resolved.
  ["meta-webhook.ts GET /social/meta/webhook", "Meta verification handshake (hub.challenge + verify token)"],
  ["meta-webhook.ts POST /social/meta/webhook", "Meta signature x-hub-signature-256 over the raw body"],
  ["whatsapp-sync.ts POST /social/whatsapp/webhook", "Evolution webhook secret (WHATSAPP_EVOLUTION_WEBHOOK_SECRET)"],

  // OAuth redirect: authenticated by the stored state, not by a session.
  ["meta.ts GET /social/meta/callback", "OAuth state from mena_oauth_states; workspace comes from the state record"],

  // Owner console: a separate credential (MENA_OWNER_CONSOLE_TOKEN) plus its own
  // rate limiter, and cross-workspace by design — that is the job of the console.
  ["owner.ts GET /session", "owner console token"],
  ["owner.ts GET /overview", "owner console token"],
  ["owner.ts GET /auto-replies", "owner console token"],
  ["owner.ts GET /workers", "owner console token"],
  ["owner.ts GET /workspaces", "owner console token"],
  ["owner.ts GET /workspaces/:id", "owner console token"],

  // Public catalogue: no tenant data at all.
  ["plans.ts GET /plans", "public plan catalogue"],

  // Capability URLs: signed, expiring links used as media src in webviews and by
  // Meta's scraper, which cannot send the merchant's session.
  ["product-media.ts GET /social/products/public-media/:mediaId", "signed media URL (verifySignedMediaRequest: mediaId + expires + signature + variant)"],
  ["whatsapp-messages.ts GET /social/whatsapp/public-media/:mediaId", "signed media URL (verifySignedMediaRequest)"],

  // Device-scoped, authenticated by user: a push token belongs to a device that
  // serves every workspace its owner belongs to, and registration must also work
  // during onboarding, before a workspace row exists.
  ["push-notifications.ts POST /notifications/push-token", "authenticated by requestOwnerId; 401 without it"],
  ["push-notifications.ts GET /notifications/push-tokens", "authenticated by requestOwnerId"],
  ["push-notifications.ts DELETE /notifications/push-token", "authenticated by requestOwnerId"],

  // Lists the caller's own workspaces: the workspace is the result, not a
  // precondition, so there is nothing to scope yet.
  ["workspaces.ts GET /workspaces", "authenticated by user; returns only that user's memberships"],
]);

const HANDLER_START = /\b(?:async\s*)?\(\s*_?(?:req|request)\b/;

function collectRegistrations() {
  const found = [];
  for (const file of readdirSync(ROUTES_DIR).filter((name) => name.endsWith(".ts")).sort()) {
    const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");
    const matches = [
      ...source.matchAll(/router\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g),
    ];
    matches.forEach((match, index) => {
      const afterPath = match.index + match[0].length;
      const nextStart = index + 1 < matches.length ? matches[index + 1].index : source.length;
      const slice = source.slice(afterPath, nextStart);
      // The middleware chain is whatever precedes the handler function.
      const handlerAt = slice.search(HANDLER_START);
      const chain = handlerAt === -1 ? slice : slice.slice(0, handlerAt);
      const method = match[1].toUpperCase();
      const routePath = match[2];
      found.push({ file, method, routePath, chain, key: `${file} ${method} ${routePath}` });
    });
  }
  return found;
}

const registrations = collectRegistrations();

test("the scan still sees the whole HTTP surface", () => {
  // Guards against the regex silently rotting: if route registrations change
  // shape, this fails instead of the suite passing over an empty list.
  assert.ok(
    registrations.length >= 95,
    `expected at least 95 route registrations, scanned ${registrations.length}`,
  );
  // 34 of the files in src/routes register routes; the rest are helpers or
  // re-exports. The floor sits below today's count so refactors do not trip it,
  // but far above zero so a broken regex cannot pass vacuously.
  const files = new Set(registrations.map((entry) => entry.file));
  assert.ok(files.size >= 30, `expected at least 30 route files, saw ${files.size}`);
});

test("every route is workspace-scoped or explicitly exempt", () => {
  const unguarded = registrations.filter(
    (entry) => !entry.chain.includes("requireWorkspace") && !EXEMPT.has(entry.key),
  );
  assert.deepEqual(
    unguarded.map((entry) => entry.key),
    [],
    "هذه المسارات لا تمرّ عبر requireWorkspace وليست في قائمة الاستثناءات الموثّقة — " +
      "أضف الوسيط (الافتراضي الصحيح) أو وثّق الحماية البديلة في EXEMPT",
  );
});

test("write routes are never exempt", () => {
  // A mutation that skips workspace scoping is the dangerous case: it can write
  // into another tenant's data rather than merely read it. Webhooks are the only
  // sanctioned writers and they are signature-authenticated.
  const risky = registrations.filter(
    (entry) =>
      entry.method !== "GET" &&
      !entry.chain.includes("requireWorkspace") &&
      !["meta-webhook.ts POST /social/meta/webhook", "whatsapp-sync.ts POST /social/whatsapp/webhook", "push-notifications.ts POST /notifications/push-token", "push-notifications.ts DELETE /notifications/push-token"].includes(entry.key),
  );
  assert.deepEqual(risky.map((entry) => entry.key), []);
});

test("the exemption list has no stale entries", () => {
  const keys = new Set(registrations.map((entry) => entry.key));
  const stale = [...EXEMPT.keys()].filter((key) => !keys.has(key));
  assert.deepEqual(
    stale,
    [],
    "هذه الاستثناءات لم تعد تطابق أي مسار موجود — احذفها حتى لا تتراكم ثغرات معتمدة",
  );
});

test("every exemption states the protection that replaces workspace scoping", () => {
  for (const [key, reason] of EXEMPT) {
    assert.ok(reason.trim().length >= 12, `${key}: سبب الاستثناء قصير أو فارغ`);
  }
});
