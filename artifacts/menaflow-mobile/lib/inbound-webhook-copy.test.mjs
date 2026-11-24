import assert from "node:assert/strict";
import test from "node:test";
import {
  webhookAttemptFacts,
  webhookAttemptHeadline,
} from "./inbound-webhook-copy.ts";

const formatNumber = (value) => String(value);
const formatDateTime = (value) =>
  value ? value.replace("T", " ").slice(0, 16) : null;
const formatters = { formatNumber, formatDateTime };

const healthy = {
  count: 12,
  lastAt: "2026-11-24T03:45:00.000Z",
  lastEvent: "WHATSAPP_WEBHOOK_PROCESSED",
  lastHint: "تمت معالجة الحدث.",
  acceptedCount: 12,
  rejectedCount: 0,
  lastRejectedEvent: null,
  lastRejectedHint: null,
};

test("a fully accepted window says so and names the last attempt", () => {
  const headline = webhookAttemptHeadline(healthy, formatters);
  assert.equal(
    headline,
    "استقبل الخادم 12 محاولة وعالجها جميعًا، آخرها 2026-11-24 03:45.",
  );
});

test("every attempt refused is stated as a refusal with the recorded reason", () => {
  const headline = webhookAttemptHeadline(
    {
      count: 5,
      lastAt: "2026-11-24T03:50:00.000Z",
      lastEvent: "WHATSAPP_WEBHOOK_REJECTED_SECRET",
      lastHint: null,
      acceptedCount: 0,
      rejectedCount: 5,
      lastRejectedEvent: "WHATSAPP_WEBHOOK_REJECTED_SECRET",
      lastRejectedHint: "رأس x-evolution-api-key لا يطابق السر.",
    },
    formatters,
  );
  assert.match(headline, /رُفضت كلها/);
  assert.match(headline, /رأس x-evolution-api-key/);
});

test("a mixed window reports both halves instead of hiding the refusals", () => {
  const headline = webhookAttemptHeadline(
    { ...healthy, acceptedCount: 9, rejectedCount: 3, lastRejectedEvent: "META_WEBHOOK_REJECTED_SIGNATURE", lastRejectedHint: "التوقيع غير صالح." },
    formatters,
  );
  assert.match(headline, /استقبل الخادم 12 محاولة ونجح في 9 منها/);
  assert.match(headline, /رُفضت 3/);
  assert.match(headline, /التوقيع غير صالح/);
});

test("zero recorded attempts are left to the diagnostic issues", () => {
  // The issue ladder already names this case with the fix that applies; a
  // neutral sentence here would soften a critical finding.
  const empty = { ...healthy, count: 0, acceptedCount: 0, lastAt: null };
  assert.equal(webhookAttemptHeadline(empty, formatters), null);
  assert.deepEqual(webhookAttemptFacts(empty, formatters), []);
  assert.equal(webhookAttemptHeadline(null, formatters), null);
  assert.equal(webhookAttemptHeadline(undefined, formatters), null);
  assert.deepEqual(webhookAttemptFacts(null, formatters), []);
});

test("the fact rows show the counts and only name refusals when there are any", () => {
  assert.deepEqual(webhookAttemptFacts(healthy, formatters), [
    { label: "محاولات الويب هوك المسجّلة", value: "12" },
    { label: "آخر محاولة", value: "2026-11-24 03:45" },
  ]);

  const refused = webhookAttemptFacts(
    {
      ...healthy,
      acceptedCount: 0,
      rejectedCount: 12,
      lastRejectedEvent: "WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE",
      lastRejectedHint: "لا يوجد اتصال واتساب بهذا الاسم.",
    },
    formatters,
  );
  assert.deepEqual(refused, [
    { label: "محاولات الويب هوك المسجّلة", value: "12" },
    { label: "آخر محاولة", value: "2026-11-24 03:45" },
    { label: "محاولات مرفوضة", value: "12" },
    { label: "سبب آخر رفض", value: "لا يوجد اتصال واتساب بهذا الاسم." },
  ]);
});

test("a missing hint falls back to the recorded event name", () => {
  const facts = webhookAttemptFacts(
    {
      ...healthy,
      acceptedCount: 11,
      rejectedCount: 1,
      lastRejectedEvent: "META_WEBHOOK_UNKNOWN_ACCOUNT",
      lastRejectedHint: "   ",
    },
    formatters,
  );
  assert.deepEqual(facts.at(-1), {
    label: "سبب آخر رفض",
    value: "META_WEBHOOK_UNKNOWN_ACCOUNT",
  });
  assert.match(
    webhookAttemptHeadline(
      {
        ...healthy,
        acceptedCount: 11,
        rejectedCount: 1,
        lastRejectedEvent: "META_WEBHOOK_UNKNOWN_ACCOUNT",
        lastRejectedHint: null,
      },
      formatters,
    ),
    /META_WEBHOOK_UNKNOWN_ACCOUNT/,
  );
});

test("an unformattable timestamp still yields a usable row and sentence", () => {
  const facts = webhookAttemptFacts({ ...healthy, lastAt: null }, formatters);
  assert.deepEqual(facts[1], { label: "آخر محاولة", value: "غير مؤرّخة" });
  assert.equal(
    webhookAttemptHeadline({ ...healthy, lastAt: null }, formatters),
    "استقبل الخادم 12 محاولة وعالجها جميعًا.",
  );
});

test("nonsensical counts cannot produce a negative or invented number", () => {
  // A corrupted row must not read as "-3 attempts accepted".
  const headline = webhookAttemptHeadline(
    { ...healthy, count: Number.NaN, rejectedCount: Number.NaN },
    formatters,
  );
  assert.equal(headline, null);
  const facts = webhookAttemptFacts(
    { ...healthy, count: 4, rejectedCount: 99 },
    formatters,
  );
  // More refusals than attempts is impossible; the headline still reports the
  // refusal because the recorded rejection is the fact worth acting on.
  assert.match(
    webhookAttemptHeadline({ ...healthy, count: 4, rejectedCount: 99 }, formatters),
    /رُفضت/,
  );
  // Three rows: the refusal is counted, but no reason row is invented when the
  // log recorded neither a hint nor an event name for it.
  assert.deepEqual(facts, [
    { label: "محاولات الويب هوك المسجّلة", value: "4" },
    { label: "آخر محاولة", value: "2026-11-24 03:45" },
    { label: "محاولات مرفوضة", value: "99" },
  ]);
});
