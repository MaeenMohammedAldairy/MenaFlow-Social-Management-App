import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  buildNotificationContent,
  hourBucket,
  truncateText,
} from "./notification-content.ts";

test("every event type produces Arabic wording", () => {
  const drafts = [
    {
      eventType: "customer_message",
      conversationId: "person-1",
      platform: "instagram",
      customerName: "سارة",
      preview: "هل المنتج متوفر؟",
      at: new Date("2026-11-22T10:00:00Z"),
    },
    {
      eventType: "publish_failure",
      productName: "قميص قطن",
      reason: "انتهت صلاحية التوكن",
      at: new Date("2026-11-22T10:00:00Z"),
    },
    {
      eventType: "new_order",
      orderId: "order-1",
      customerName: "أحمد",
      totalLabel: "٥٠٠٠ ريال",
      at: new Date("2026-11-22T10:00:00Z"),
    },
    {
      eventType: "quota_exhausted",
      meter: "aiGenerations",
      used: 100,
      limit: 100,
      periodKey: "2026-11",
      at: new Date("2026-11-22T10:00:00Z"),
    },
  ];

  const arabic = /[\u0600-\u06FF]/;
  for (const draft of drafts) {
    const content = buildNotificationContent(draft);
    assert.match(content.title, arabic, `${draft.eventType} title`);
    assert.match(content.body, arabic, `${draft.eventType} body`);
    assert.equal(content.eventType, draft.eventType);
  }
});

test("customer messages are throttled to one alert per conversation per hour", () => {
  const base = {
    eventType: "customer_message",
    conversationId: "person-7",
    platform: "instagram",
  };

  const first = buildNotificationContent({ ...base, at: new Date("2026-11-22T10:00:00Z") });
  const second = buildNotificationContent({ ...base, at: new Date("2026-11-22T10:59:59Z") });
  const nextHour = buildNotificationContent({ ...base, at: new Date("2026-11-22T11:00:00Z") });

  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.notEqual(first.dedupeKey, nextHour.dedupeKey);
});

test("different conversations never share a dedupe key in the same hour", () => {
  const at = new Date("2026-11-22T10:30:00Z");
  const one = buildNotificationContent({
    eventType: "customer_message",
    conversationId: "person-1",
    platform: "instagram",
    at,
  });
  const two = buildNotificationContent({
    eventType: "customer_message",
    conversationId: "person-2",
    platform: "instagram",
    at,
  });

  assert.notEqual(one.dedupeKey, two.dedupeKey);
});

test("an order dedupes on its id alone, so a retried enqueue is idempotent", () => {
  const first = buildNotificationContent({
    eventType: "new_order",
    orderId: "order-99",
    at: new Date("2026-11-22T10:00:00Z"),
  });
  const muchLater = buildNotificationContent({
    eventType: "new_order",
    orderId: "order-99",
    at: new Date("2026-12-01T08:00:00Z"),
  });

  assert.equal(first.dedupeKey, "order-99");
  assert.equal(muchLater.dedupeKey, first.dedupeKey);
});

test("quota exhaustion alerts exactly once per meter per billing period", () => {
  const at = new Date("2026-11-22T10:00:00Z");
  const first = buildNotificationContent({
    eventType: "quota_exhausted",
    meter: "aiGenerations",
    used: 100,
    limit: 100,
    periodKey: "2026-11",
    at,
  });
  // Every later blocked action in the same period must reuse the key, otherwise
  // the merchant gets an alert per attempt.
  const laterSamePeriod = buildNotificationContent({
    eventType: "quota_exhausted",
    meter: "aiGenerations",
    used: 137,
    limit: 100,
    periodKey: "2026-11",
    at: new Date("2026-11-28T19:00:00Z"),
  });
  const nextPeriod = buildNotificationContent({
    eventType: "quota_exhausted",
    meter: "aiGenerations",
    used: 100,
    limit: 100,
    periodKey: "2026-12",
    at: new Date("2026-12-01T00:30:00Z"),
  });
  const otherMeter = buildNotificationContent({
    eventType: "quota_exhausted",
    meter: "postsCreated",
    used: 30,
    limit: 30,
    periodKey: "2026-11",
    at,
  });

  assert.equal(laterSamePeriod.dedupeKey, first.dedupeKey);
  assert.notEqual(nextPeriod.dedupeKey, first.dedupeKey);
  assert.notEqual(otherMeter.dedupeKey, first.dedupeKey);
});

test("a Meta conversation deep-links to the thread and WhatsApp to its inbox", () => {
  const meta = buildNotificationContent({
    eventType: "customer_message",
    conversationId: "person 1/x",
    platform: "instagram",
    at: new Date("2026-11-22T10:00:00Z"),
  });
  const whatsapp = buildNotificationContent({
    eventType: "customer_message",
    at: new Date("2026-11-22T10:00:00Z"),
  });

  // Encoded, because an unencoded id with a slash would change the route depth.
  assert.equal(
    meta.data.route,
    `/inbox/${encodeURIComponent("person 1/x")}?platform=instagram`,
  );
  assert.equal(whatsapp.data.route, "/inbox/whatsapp");
  assert.equal(whatsapp.data.conversationId, undefined);
});

test("every deep link points at a route that exists in the mobile app", () => {
  const known = new Set([
    "/inbox/whatsapp",
    "/(tabs)/products",
    "/(tabs)/more/orders",
    "/(tabs)/more/settings",
  ]);

  const routes = [
    buildNotificationContent({
      eventType: "customer_message",
      at: new Date("2026-11-22T10:00:00Z"),
    }).data.route,
    buildNotificationContent({
      eventType: "publish_failure",
      productName: "منتج",
      at: new Date("2026-11-22T10:00:00Z"),
    }).data.route,
    buildNotificationContent({
      eventType: "new_order",
      orderId: "o1",
      at: new Date("2026-11-22T10:00:00Z"),
    }).data.route,
    buildNotificationContent({
      eventType: "quota_exhausted",
      meter: "postsCreated",
      used: 1,
      limit: 1,
      periodKey: "2026-11",
      at: new Date("2026-11-22T10:00:00Z"),
    }).data.route,
  ];

  for (const route of routes) assert.ok(known.has(route), `غير معروف: ${route}`);
});

test("Expo requires every data value to be a string", () => {
  const content = buildNotificationContent({
    eventType: "new_order",
    orderId: "order-1",
    customerName: "أحمد",
    totalLabel: "٥٠٠٠ ريال",
    at: new Date("2026-11-22T10:00:00Z"),
  });

  for (const [key, value] of Object.entries(content.data)) {
    assert.equal(typeof value, "string", `${key} ليس نصًا`);
  }
  assert.equal(content.data.orderId, "order-1");
});

test("an oversized preview is dropped rather than failing the whole message", () => {
  const huge = "ا".repeat(4000);
  const content = buildNotificationContent({
    eventType: "customer_message",
    conversationId: "person-3",
    platform: "facebook",
    customerName: "عميل",
    preview: huge,
    at: new Date("2026-11-22T10:00:00Z"),
  });

  // The body is truncated independently, so it stays readable...
  assert.ok([...content.body].length <= MAX_BODY_LENGTH);
  // ...and the payload no longer carries the huge field.
  assert.equal(content.data.preview, undefined);
  assert.equal(content.data.route, "/inbox/person-3?platform=facebook");
  assert.ok(JSON.stringify(content.data).length < 1024);
});

test("truncateText respects the limit and never ends mid-word", () => {
  const long = "كلمة ".repeat(60).trim();
  const cut = truncateText(long, 40);

  assert.ok([...cut].length <= 40);
  assert.ok(cut.endsWith("…"));
  assert.ok(!cut.slice(0, -1).endsWith(" "), "لا ينتهي بمسافة قبل الحذف");

  assert.equal(truncateText("قصير", 40), "قصير");
  assert.equal(truncateText("  مسافات   متعددة  ", 40), "مسافات متعددة");
});

test("hourBucket is UTC, zero-padded and one hour wide", () => {
  assert.equal(hourBucket(new Date("2026-01-05T07:00:00Z")), "2026010507");
  assert.equal(hourBucket(new Date("2026-01-05T07:59:59.999Z")), "2026010507");
  assert.equal(hourBucket(new Date("2026-01-05T08:00:00Z")), "2026010508");
  // A local-timezone bucket would shift for a merchant in Sanaa (UTC+3) and
  // split one hour of alerts across two keys.
  assert.equal(hourBucket(new Date("2026-12-31T23:30:00Z")), "2026123123");
});

test("the notification limits are the ones the code enforces", () => {
  assert.equal(MAX_TITLE_LENGTH, 60);
  assert.equal(MAX_BODY_LENGTH, 140);
  const content = buildNotificationContent({
    eventType: "publish_failure",
    productName: "اسم منتج طويل جدًا ".repeat(20),
    reason: "سبب طويل جدًا ".repeat(30),
    at: new Date("2026-11-22T10:00:00Z"),
  });

  assert.ok([...content.title].length <= MAX_TITLE_LENGTH);
  assert.ok([...content.body].length <= MAX_BODY_LENGTH);
});
