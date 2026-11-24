import assert from "node:assert/strict";
import test from "node:test";

const { analysisSummaryMessage } = await import("./extraction-quota-copy.ts");

/** Stands in for the app's Arabic-digit formatter. */
const formatNumber = (value) => `#${value}`;

const quota = (overrides = {}) => ({
  messages: 0,
  estimatedGenerations: 0,
  worstCaseGenerations: 0,
  used: 0,
  limit: 100,
  remaining: 100,
  fitsWithinQuota: true,
  messagesWithinQuota: 0,
  ...overrides,
});

test("nothing queued says so without mentioning quota", () => {
  const message = analysisSummaryMessage({ queuedMessages: 0 }, formatNumber);
  assert.ok(message.includes("لا توجد رسائل جديدة"), message);
  assert.ok(!message.includes("حصة"), message);
});

test("a queued batch is counted with the injected formatter", () => {
  const message = analysisSummaryMessage({ queuedMessages: 12 }, formatNumber);
  assert.ok(message.includes("#12"), message);
  // Drafts are never published without review; the summary keeps saying so.
  assert.ok(message.includes("لا تُجدول للنشر تلقائيًا"), message);
});

test("a batch the quota covers reports the remaining quota", () => {
  const message = analysisSummaryMessage(
    { queuedMessages: 5, quota: quota({ remaining: 40, limit: 100 }) },
    formatNumber,
  );
  assert.ok(message.includes("#40"), message);
  assert.ok(message.includes("#100"), message);
  assert.ok(!message.includes("تنتظر البقية"), message);
});

test("a batch larger than the quota says what runs now and what waits", () => {
  const message = analysisSummaryMessage(
    {
      queuedMessages: 200,
      quota: quota({
        remaining: 10,
        limit: 200,
        fitsWithinQuota: false,
        messagesWithinQuota: 10,
      }),
    },
    formatNumber,
  );
  assert.ok(message.includes("#200"), message);
  assert.ok(message.includes("#10"), message);
  assert.ok(message.includes("تنتظر البقية تلقائيًا"), message);
  assert.ok(message.includes("ترقّي خطتك"), message);
});

test("an exhausted quota still explains the pause instead of failing silently", () => {
  const message = analysisSummaryMessage(
    {
      queuedMessages: 30,
      quota: quota({
        used: 100,
        limit: 100,
        remaining: 0,
        fitsWithinQuota: false,
        messagesWithinQuota: 0,
      }),
    },
    formatNumber,
  );
  assert.ok(message.includes("لتحليل #0 رسالة الآن"), message);
  assert.ok(message.includes("تتجدد الحصة"), message);
});

test("a missing estimate degrades to the plain summary", () => {
  const message = analysisSummaryMessage(
    { queuedMessages: 4, quota: undefined },
    formatNumber,
  );
  assert.ok(message.includes("#4"), message);
  assert.ok(!message.includes("حصة"), message);
});
