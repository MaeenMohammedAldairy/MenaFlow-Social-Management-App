import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePostReportSummary,
  parsePostReportRange,
  postReportCutoff,
} from "./post-report-summary.ts";

test("accepts only supported report ranges", () => {
  assert.equal(parsePostReportRange("7"), "7");
  assert.equal(parsePostReportRange("30"), "30");
  assert.equal(parsePostReportRange("all"), "all");
  assert.equal(parsePostReportRange("365"), null);
});

test("uses a rolling-day cutoff and no cutoff for all-time reports", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  assert.equal(
    postReportCutoff("7", now)?.toISOString(),
    "2026-11-02T12:00:00.000Z",
  );
  assert.equal(postReportCutoff("all", now), null);
});

test("preserves aggregated totals larger than the first posts page", () => {
  assert.deepEqual(normalizePostReportSummary({
    total: "37",
    draft: "21",
    review: "4",
    scheduled: "1",
    approved: "2",
    publishing: "1",
    published: "6",
    failed: "2",
    instagram: "22",
    facebook: "18",
    whatsapp: "3",
  }), {
    total: 37,
    draft: 21,
    review: 4,
    scheduled: 1,
    approved: 2,
    publishing: 1,
    published: 6,
    failed: 2,
    instagram: 22,
    facebook: 18,
    whatsapp: 3,
  });
});
