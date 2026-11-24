import assert from "node:assert/strict";
import test from "node:test";

import { orphanCleanupSentence } from "./whatsapp-orphan-cleanup-copy.ts";

const EASTERN = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const formatters = {
  formatNumber: (value) =>
    String(Math.floor(value))
      .split("")
      .map((digit) => EASTERN[Number(digit)] ?? digit)
      .join(""),
};

function summary(overrides = {}) {
  return { attempted: true, deleted: 0, failed: 0, skipped: 0, instances: [], ...overrides };
}

function claimed(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    instanceName: `menaflow-claimed${index}`,
    action: "skipped",
    reason: "CLAIMED_BY_WORKSPACE",
  }));
}

test("says nothing when the sweep did not run", () => {
  assert.equal(orphanCleanupSentence(null, formatters), null);
  assert.equal(orphanCleanupSentence(undefined, formatters), null);
  assert.equal(
    orphanCleanupSentence(summary({ attempted: false, deleted: 3 }), formatters),
    null,
    "counts from a sweep that never ran must not be reported",
  );
});

test("says nothing when the server was already clean", () => {
  assert.equal(orphanCleanupSentence(summary(), formatters), null);
  assert.equal(
    orphanCleanupSentence(
      summary({ skipped: 2, instances: [{ action: "skipped", reason: "PHONE_NUMBER_MISMATCH" }] }),
      formatters,
    ),
    null,
    "an instance bound to another phone is not the merchant's problem to hear about",
  );
});

test("one removed session reads as feminine singular", () => {
  const sentence = orphanCleanupSentence(summary({ deleted: 1 }), formatters);
  assert.equal(
    sentence,
    "وجد الخادم جلسة واتساب قديمة مرتبطة بالرقم نفسه ولا تخص أي مساحة عمل، فأزالها. الرسائل التي كانت تصل إليها كانت تُرفض فلا تظهر في صندوق الوارد.",
  );
});

test("two removed sessions take the dual everywhere", () => {
  const sentence = orphanCleanupSentence(summary({ deleted: 2 }), formatters);
  assert.match(sentence, /جلستي واتساب قديمتين مرتبطتين/);
  assert.match(sentence, /ولا تخصان أي مساحة عمل، فأزالهما/);
  assert.match(sentence, /تصل إليهما/);
  assert.doesNotMatch(sentence, /فأزالها\./, "the dual must not borrow the singular pronoun");
});

test("three to ten take the plural and eleven above the singular", () => {
  assert.match(orphanCleanupSentence(summary({ deleted: 3 }), formatters), /٣ جلسات واتساب قديمة/);
  assert.match(orphanCleanupSentence(summary({ deleted: 10 }), formatters), /١٠ جلسات واتساب قديمة/);
  assert.match(orphanCleanupSentence(summary({ deleted: 11 }), formatters), /١١ جلسة واتساب قديمة/);
});

test("never writes a bare number before a noun for one or two", () => {
  for (const deleted of [1, 2]) {
    const sentence = orphanCleanupSentence(summary({ deleted }), formatters);
    assert.doesNotMatch(sentence, /١ جلسة/);
    assert.doesNotMatch(sentence, /٢ جلسة/);
    assert.doesNotMatch(sentence, /١ جلسات|٢ جلسات/);
  }
});

test("a partial failure is reported without a count", () => {
  const sentence = orphanCleanupSentence(summary({ deleted: 1, failed: 2 }), formatters);
  assert.match(sentence, /^وجد الخادم جلسة واتساب قديمة/);
  assert.match(sentence, /وتعذّر إزالة جلسات أخرى؛ أعد المحاولة بعد قليل\.$/);
  assert.doesNotMatch(sentence, /وتعذّر إزالة ٢/, "the count would read as «٢ منها»");
});

test("a failure with nothing removed still tells the merchant to retry", () => {
  const sentence = orphanCleanupSentence(summary({ failed: 3 }), formatters);
  assert.equal(
    sentence,
    "تعذّر إزالة جلسات واتساب قديمة مرتبطة بالرقم نفسه؛ أعد المحاولة بعد قليل.",
  );
});

test("a session another workspace claims gets its own fix", () => {
  const sentence = orphanCleanupSentence(
    summary({ skipped: 1, instances: claimed() }),
    formatters,
  );
  assert.equal(
    sentence,
    "توجد جلسة واتساب أخرى مرتبطة بالرقم نفسه ومسجَّلة في مساحة عمل أخرى؛ افصلها من تلك المساحة لتصل الرسائل إلى هذه المساحة.",
  );
  assert.doesNotMatch(sentence, /أزال/, "nothing was removed, so nothing may claim it was");
});

test("removal and a claimed session are reported together", () => {
  const sentence = orphanCleanupSentence(
    summary({ deleted: 1, skipped: 1, instances: claimed() }),
    formatters,
  );
  assert.match(sentence, /فأزالها\./);
  assert.match(sentence, /افصلها من تلك المساحة لتصل الرسائل إلى هذه المساحة\.$/);
});

test("malformed counts and instances degrade instead of breaking", () => {
  assert.match(
    orphanCleanupSentence(summary({ deleted: 1.9 }), formatters),
    /جلسة واتساب قديمة مرتبطة/,
  );
  assert.equal(orphanCleanupSentence(summary({ deleted: -3 }), formatters), null);
  assert.equal(orphanCleanupSentence(summary({ deleted: null }), formatters), null);
  assert.equal(
    orphanCleanupSentence(summary({ instances: null }), formatters),
    null,
  );
  assert.equal(
    orphanCleanupSentence(summary({ instances: [null, {}, { action: "skipped" }] }), formatters),
    null,
  );
});
