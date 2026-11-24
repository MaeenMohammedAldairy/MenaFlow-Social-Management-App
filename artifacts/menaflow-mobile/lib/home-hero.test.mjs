import assert from "node:assert/strict";
import test from "node:test";
import { homeHero } from "./home-hero.ts";

/** Everything fine, posts loaded, one waiting draft: the baseline state. */
const BASE = {
  connectionsLoading: false,
  connectionsUnavailable: false,
  retryingConnections: false,
  connectionsFetching: false,
  accountNeedingReauthorization: null,
  whatsappConnecting: false,
  whatsappUnavailable: false,
  whatsappNeedsReconnection: false,
  hasAnyConnection: true,
  postsReady: true,
  postCount: 3,
  pendingPostStatus: "draft",
};

const hero = (overrides) => homeHero({ ...BASE, ...overrides });

test("the branch order is the product decision: a broken link outranks everything", () => {
  // Every flag set at once must still produce the highest-priority message, not the
  // last one that happens to match. This is the ordering that used to live as the
  // sequence of an if-chain in the middle of a screen.
  const all = hero({
    connectionsLoading: true,
    connectionsUnavailable: true,
    accountNeedingReauthorization: { platform: "instagram", name: "إنستغرام" },
    whatsappConnecting: true,
    whatsappUnavailable: true,
    whatsappNeedsReconnection: true,
    hasAnyConnection: false,
    postsReady: false,
    postCount: 0,
    pendingPostStatus: "failed",
  });
  assert.equal(all.title, "نجهز مساحة عملك", "loading outranks a failed check");

  const withoutLoading = hero({
    ...BASE,
    connectionsLoading: false,
    connectionsUnavailable: true,
    accountNeedingReauthorization: { platform: "instagram", name: "إنستغرام" },
    whatsappConnecting: true,
    hasAnyConnection: false,
  });
  assert.equal(withoutLoading.title, "تعذر التحقق", "a failed check outranks a lost authorisation");

  const reauth = hero({
    accountNeedingReauthorization: { platform: "instagram", name: "إنستغرام" },
    whatsappConnecting: true,
    whatsappUnavailable: true,
    hasAnyConnection: false,
    postCount: 0,
  });
  assert.equal(reauth.title, "أعد تفويض حساب إنستغرام");
  assert.equal(reauth.primary.action, "reauthorize-meta");
  assert.equal(reauth.primary.platform, "instagram");
});

test("WhatsApp mid-handshake outranks WhatsApp broken, which outranks nothing linked", () => {
  assert.equal(hero({ whatsappConnecting: true }).title, "واتساب قيد الاتصال");
  assert.equal(
    hero({ whatsappConnecting: true, hasAnyConnection: false }).primary.action,
    "manage-whatsapp",
  );

  const unavailable = hero({ whatsappUnavailable: true });
  assert.equal(unavailable.title, "تعذر الوصول إلى خدمة واتساب");
  assert.equal(unavailable.primary.label, "إدارة واتساب");
  assert.equal(unavailable.primary.icon, "settings");
  assert.equal(unavailable.primary.action, "manage-whatsapp");

  // Unavailable wins over "needs reconnecting" because it is the more specific
  // diagnosis: the provider cannot be reached at all.
  const both = hero({ whatsappUnavailable: true, whatsappNeedsReconnection: true });
  assert.equal(both.primary.action, "manage-whatsapp");

  const reconnect = hero({ whatsappNeedsReconnection: true });
  assert.equal(reconnect.title, "أعد اتصال واتساب");
  assert.equal(reconnect.primary.label, "إعادة الاتصال");
  assert.equal(reconnect.primary.action, "reconnect-whatsapp");

  const none = hero({ hasAnyConnection: false });
  assert.equal(none.title, "اربط حسابًا للنشر");
  assert.equal(none.primary.action, "link-account");
  assert.equal(none.eyebrow, "ابدأ من هنا");
});

test("a retry in flight says so and cannot be tapped twice", () => {
  const idle = hero({ connectionsUnavailable: true });
  assert.equal(idle.primary.label, "إعادة المحاولة");
  assert.equal(idle.primary.disabled, false);

  const retrying = hero({ connectionsUnavailable: true, retryingConnections: true });
  assert.equal(retrying.primary.label, "جارٍ التحقق…");
  assert.equal(retrying.primary.disabled, true);

  // A background refetch also disables it: two concurrent connection checks are
  // one request wasted and a spinner that lies about which tap caused it.
  const fetching = hero({ connectionsUnavailable: true, connectionsFetching: true });
  assert.equal(fetching.primary.disabled, true);
});

test("while the post list has not loaded the hero claims nothing about posts", () => {
  const notReady = hero({ postsReady: false, postCount: 0, pendingPostStatus: null });
  assert.equal(notReady.title, "جارٍ تحميل محتواك");
  // The button still creates content: it does not depend on the list having loaded.
  assert.equal(notReady.primary.action, "create-content");
  assert.equal(notReady.primary.disabled, false);
});

test("an empty post list asks for the first post", () => {
  const empty = hero({ postCount: 0, pendingPostStatus: null });
  assert.equal(empty.title, "أنشئ أول منشور");
  assert.equal(empty.primary.label, "إنشاء أول منشور");
  assert.equal(empty.primary.action, "create-content");
});

test("each waiting post status gets its own words and opens its own slice", () => {
  const cases = [
    ["failed", "منشور تعذّر نشره", "مراجعة المنشور"],
    ["review", "منشور بانتظار المراجعة", "مراجعة المنشورات"],
    ["draft", "لديك مسودة للمتابعة", "متابعة المسودات"],
  ];
  for (const [pendingPostStatus, title, label] of cases) {
    const result = hero({ pendingPostStatus });
    assert.equal(result.title, title, pendingPostStatus);
    assert.equal(result.primary.label, label, pendingPostStatus);
    assert.equal(result.primary.action, "open-post-queue");
    assert.equal(result.primary.postStatus, pendingPostStatus);
    assert.equal(result.primary.icon, "file-text");
  }
});

test("nothing wrong and nothing waiting leaves the merchant in peace", () => {
  const calm = hero({ pendingPostStatus: null });
  assert.equal(calm.eyebrow, "مساحة عملك");
  assert.equal(calm.title, "حساباتك جاهزة للنشر");
  assert.equal(calm.primary.action, "create-content");
  assert.equal(calm.primary.disabled, false);
});

test("every branch returns a complete hero", () => {
  // A branch that forgot the eyebrow or the button renders an empty strip at the top
  // of the home screen, which is what the accessibility label reads first.
  const states = [
    { connectionsLoading: true },
    { connectionsUnavailable: true },
    { accountNeedingReauthorization: { platform: "facebook", name: "فيسبوك" } },
    { whatsappConnecting: true },
    { whatsappUnavailable: true },
    { whatsappNeedsReconnection: true },
    { hasAnyConnection: false },
    { postsReady: false },
    { postCount: 0, pendingPostStatus: null },
    { pendingPostStatus: "failed" },
    {},
  ];
  for (const overrides of states) {
    const result = hero(overrides);
    for (const field of ["eyebrow", "title", "body"]) {
      assert.ok(
        typeof result[field] === "string" && result[field].trim().length > 0,
        `${JSON.stringify(overrides)} → ${field} فارغ`,
      );
    }
    assert.ok(result.primary.label.trim().length > 0, JSON.stringify(overrides));
    assert.ok(result.primary.icon, JSON.stringify(overrides));
    assert.ok(result.primary.action, JSON.stringify(overrides));
    assert.equal(typeof result.primary.disabled, "boolean");
  }
});
