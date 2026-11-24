import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  KNOWN_ALERT_EVENT_TYPES,
  isKnownAlertEventType,
  postsSyncForAlertData,
  queryPrefixesForAlertData,
} from "./alert-invalidation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const mobileDir = resolve(here, "..");
const repoRoot = resolve(here, "..", "..", "..");
const pushMigration = join(
  repoRoot,
  "supabase",
  "migrations",
  "20261122001000_push_notifications.sql",
);

/** Every `.ts`/`.tsx` source file of the mobile app, excluding dependencies. */
function mobileSources(dir = mobileDir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) mobileSources(full, found);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) found.push(full);
  }
  return found;
}

test("the known event types are exactly the ones the database allows", () => {
  // The server's outbox cannot hold an event type outside this constraint, so a
  // client union that drifts from it either invents a type that can never arrive
  // or misses one that can. Reconciled against the migration rather than against
  // a copy, because the migration is what actually runs.
  assert.ok(existsSync(pushMigration), `الترحيل غير موجود: ${pushMigration}`);
  const sql = readFileSync(pushMigration, "utf8");
  const block = /event_type IN \(([^)]*)\)/s.exec(sql);
  assert.ok(block, "لم يُعثر على قيد event_type في الترحيل");
  const fromDatabase = [...block[1].matchAll(/'([^']+)'/g)]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(
    [...KNOWN_ALERT_EVENT_TYPES].sort(),
    fromDatabase,
    "اتحاد الأنواع في العميل لا يطابق قيد CHECK في القاعدة",
  );
});

test("every mapped prefix is a query key the app really uses", () => {
  // A typo'd prefix invalidates nothing and fails silently: the alert arrives, the
  // screen stays stale, and nothing logs. Checked against the sources the same way
  // alert-routes.test.mjs checks routes against the router.
  const sources = mobileSources().map((f) => readFileSync(f, "utf8")).join("\n");
  for (const eventType of KNOWN_ALERT_EVENT_TYPES) {
    for (const prefix of queryPrefixesForAlertData({ eventType })) {
      assert.equal(prefix.length, 1, `البادئة يجب أن تكون عنصرًا واحدًا: ${prefix}`);
      assert.ok(
        sources.includes(`["${prefix[0]}"`),
        `مفتاح تخزين غير مستعمل في التطبيق: ${prefix[0]} (من ${eventType})`,
      );
    }
  }
});

test("a customer message refreshes both inboxes and any open thread", () => {
  assert.deepEqual(
    queryPrefixesForAlertData({ eventType: "customer_message", route: "/inbox/x" }),
    [["meta-inbox"], ["whatsapp-direct-inbox"], ["whatsapp-direct-messages"]],
  );
});

test("a publish failure refreshes the jobs and the catalogue", () => {
  assert.deepEqual(
    queryPrefixesForAlertData({ eventType: "publish_failure", jobId: "j1" }),
    [["product-publication-jobs"], ["product-catalog"]],
  );
});

test("a new order refreshes the order list and the badge count", () => {
  assert.deepEqual(queryPrefixesForAlertData({ eventType: "new_order" }), [
    ["orders"],
    ["order-summary"],
  ]);
});

test("quota exhaustion invalidates nothing, by decision", () => {
  // No query caches usage or limits, so there is nothing to refresh. Asserted
  // explicitly so that filling this in later is a deliberate act, not an accident.
  assert.deepEqual(queryPrefixesForAlertData({ eventType: "quota_exhausted" }), []);
});

test("an event type this build does not know invalidates nothing", () => {
  // Unknown means the server moved ahead of the client. Guessing a cache to
  // invalidate would refetch unrelated data on every alert from a newer server.
  assert.deepEqual(queryPrefixesForAlertData({ eventType: "some_future_event" }), []);
  assert.equal(isKnownAlertEventType("some_future_event"), false);
});

test("payloads that are not objects are refused rather than crashing", () => {
  for (const payload of [null, undefined, "customer_message", 42, [], true]) {
    assert.deepEqual(
      queryPrefixesForAlertData(payload),
      [],
      `كان يجب رفض: ${JSON.stringify(payload) ?? String(payload)}`,
    );
  }
});

test("a missing eventType is refused", () => {
  assert.deepEqual(queryPrefixesForAlertData({ route: "/(tabs)/more/orders" }), []);
  assert.deepEqual(queryPrefixesForAlertData({}), []);
  assert.equal(isKnownAlertEventType(undefined), false);
  assert.equal(isKnownAlertEventType(7), false);
});

test("a publication failure asks for a post sync, and only it does", () => {
  // The dashboard hero ("a post failed to publish") and the header bell's
  // failed-post count are both computed from the post list, which lives outside
  // React Query — so invalidating keys cannot refresh them. Without this, the
  // alert announced a failure the screen it landed on still contradicted.
  assert.equal(postsSyncForAlertData({ eventType: "publish_failure" }), true);

  assert.equal(postsSyncForAlertData({ eventType: "customer_message" }), false);
  assert.equal(postsSyncForAlertData({ eventType: "new_order" }), false);
  assert.equal(postsSyncForAlertData({ eventType: "quota_exhausted" }), false);
});

test("every event type this build knows has an explicit posts decision", () => {
  const syncing = KNOWN_ALERT_EVENT_TYPES.filter((eventType) =>
    postsSyncForAlertData({ eventType }),
  );
  assert.deepEqual(syncing, ["publish_failure"]);
  // A sync costs a page of posts on the wire, so it is asserted per type rather
  // than defaulted: the mapping is a Record over the union, which makes a new
  // event type a compile error until somebody decides what it changes.
  for (const eventType of KNOWN_ALERT_EVENT_TYPES) {
    assert.equal(typeof postsSyncForAlertData({ eventType }), "boolean", eventType);
  }
});

test("an event type this build does not know asks for no post sync", () => {
  assert.equal(postsSyncForAlertData({ eventType: "some_future_event" }), false);
});

test("malformed payloads ask for no post sync rather than crashing", () => {
  for (const payload of [null, undefined, "publish_failure", 42, [], true, {}]) {
    assert.equal(
      postsSyncForAlertData(payload),
      false,
      `كان يجب رفض: ${JSON.stringify(payload) ?? String(payload)}`,
    );
  }
});
