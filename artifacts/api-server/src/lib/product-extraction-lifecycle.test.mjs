// ---------------------------------------------------------------------------
// The lifecycle of a WhatsApp product-extraction job.
//
// Three production incidents in three weeks were the same bug wearing three
// costumes: a job reached a state that nothing ever looked at again. The vision
// break failed every image job while 1095 tests stayed green; a currency gap made
// the accept step discard the merchant's own number; and 13 jobs sat in
// `waiting_media` with `next_run_at` an hour past, because the claim query reads
// `pending` and nothing else. The state names all said "later". No code promised
// the later would come.
//
// So the taxonomy lives in `product-extraction-lifecycle.ts` and these tests pin
// the rule that was missing: **every status names who looks at it next**, a wait
// is re-claimed and does not spend an attempt, and a closed state names what the
// merchant can do about it. A status added without an owner fails here, in the
// cheapest place it can fail.
//
// The last three tests read the production source on purpose. A taxonomy that
// the code does not import is decoration — which is exactly how `requiresReason
// ForTransition` ended up written down while two call sites still free-handed it.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(path.join(HERE, relative), "utf8");

const {
  PRODUCT_EXTRACTION_STATUSES,
  CLAIMABLE_JOB_STATUSES,
  describeProductExtractionStatus,
  productExtractionStuckStatuses,
  FRESH_WORK_JOB_STATUS,
} = await import("./product-extraction-lifecycle.ts");
const { requiresReasonForTransition, EXTRACTION_REASON_CODES } = await import(
  "./product-extraction-reasons.ts"
);

/**
 * The seven values `mena_whatsapp_product_extraction_jobs_status_check` allows,
 * read from the live database on 2026-11-27. Written out here so a status added
 * to the module without a CHECK — or the other way round — is a failing test
 * rather than a row nobody can insert.
 */
const DATABASE_STATUSES = [
  "pending",
  "processing",
  "waiting_media",
  "waiting_association",
  "complete",
  "review",
  "failed",
];

test("the taxonomy covers the database's statuses and nothing else", () => {
  assert.deepEqual(
    [...PRODUCT_EXTRACTION_STATUSES].sort(),
    [...DATABASE_STATUSES].sort(),
  );
});

test("every status names who looks at it next", () => {
  for (const status of DATABASE_STATUSES) {
    const described = describeProductExtractionStatus(status);
    assert.ok(described, `${status} has no description`);
    assert.ok(
      ["queue", "run", "event", "human", "none"].includes(described.nextBy),
      `${status} does not say who looks next (got ${described.nextBy})`,
    );
    assert.ok(
      described.actor?.length > 0,
      `${status} names no actor, which is how a wait becomes a tomb`,
    );
  }
});

test("the three waiting-looking states are claimed by the queue, not parked", () => {
  // `pending` plus both waits: the whole point. A job that wrote its own
  // `next_run_at` has to be picked up by whatever honours that timestamp.
  assert.deepEqual(
    [...CLAIMABLE_JOB_STATUSES].sort(),
    ["pending", "waiting_association", "waiting_media"].sort(),
  );
  for (const status of CLAIMABLE_JOB_STATUSES) {
    assert.equal(describeProductExtractionStatus(status).claimable, true);
  }
  for (const status of ["processing", "review", "complete", "failed"]) {
    assert.equal(describeProductExtractionStatus(status).claimable, false);
  }
});

test("a wait does not spend an attempt; a failure does", () => {
  // The queue claims with `attempts + 1`. If the pass only decided to look
  // again later, the wait refunds that attempt — otherwise five minutes of
  // photos arriving slowly dead-letters a bundle for no fault of its own, and
  // the merchant's re-run button is the only way back.
  assert.equal(describeProductExtractionStatus("waiting_media").spendsAttempt, false);
  assert.equal(
    describeProductExtractionStatus("waiting_association").spendsAttempt,
    false,
  );
  assert.equal(describeProductExtractionStatus("complete").spendsAttempt, true);
  assert.equal(describeProductExtractionStatus("failed").spendsAttempt, true);
});

test("a closed state says what the merchant can do about it", () => {
  // `failed` is reachable again with one button press; `complete` is not a
  // problem to solve. Without this field the review queue cannot tell the
  // merchant "we are done" from "we stopped", which was the original complaint.
  assert.equal(
    describeProductExtractionStatus("failed").merchantAction,
    "requeue",
  );
  assert.equal(
    describeProductExtractionStatus("complete").merchantAction,
    null,
  );
  assert.equal(
    describeProductExtractionStatus("waiting_media").merchantAction,
    null,
  );
});

test("the lifecycle and the reason table agree on what must be labelled", () => {
  // Two modules describe the same rule — `reasonRequired` here,
  // `requiresReasonForTransition` at the write site. They must not drift: a
  // status that needs a label but is not enforced is an uncountable conclusion,
  // and a status enforced but not listed hides a state from the metrics.
  for (const status of DATABASE_STATUSES) {
    assert.equal(
      describeProductExtractionStatus(status).reasonRequired,
      requiresReasonForTransition({ status }),
      `${status} disagrees about whether a reason is required`,
    );
  }
});

test("every wait names the event that releases it", () => {
  // Waiting is only safe while something is still trying. A wait without a
  // named release event is the 13 parked jobs of 2026-11-27.
  assert.equal(
    describeProductExtractionStatus("waiting_media").releaseEvent,
    "whatsapp-media-settled",
  );
  assert.equal(
    describeProductExtractionStatus("waiting_association").releaseEvent,
    "whatsapp-association-decided",
  );
  for (const status of ["pending", "processing", "complete", "review", "failed"]) {
    assert.equal(
      describeProductExtractionStatus(status).releaseEvent,
      null,
      `${status} must not claim to be waiting`,
    );
  }
});

test("the only states a merchant can be stuck in are the ones we can count", () => {
  // A job in `review` is a card on the screen; a job in `complete`/`failed` is
  // labelled. Anything else that is neither claimable nor owned by a human is
  // by definition a tomb, so the list must stay empty.
  assert.deepEqual(productExtractionStuckStatuses(), []);
});

test("every reason code is one the database will accept", () => {
  // `mena_whatsapp_product_extraction_job_reason_check` is the authority; the
  // migration that created it is in the repo, so both are read here. A code in
  // the module but not in the CHECK is a job that fails on write — which is how
  // six re-extractions died for days.
  const migration = read(
    path.join(
      "..", "..", "..", "..",
      "supabase", "migrations",
      "20261127000000_product_extraction_simplification.sql",
    ),
  );
  const block = migration.match(/mena_whatsapp_product_extraction_job_reason_check[\s\S]*?\)\);/);
  assert.ok(block, "the reason CHECK is gone from the migration");
  const allowed = [...block[0].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(allowed.length > 10, "the reason CHECK parsed empty");
  for (const code of EXTRACTION_REASON_CODES) {
    assert.ok(allowed.includes(code), `${code} is not in the database CHECK`);
  }
});

/* ------------------------------------------------------------------ *
 * The taxonomy has to be the one the code uses.
 * ------------------------------------------------------------------ */

test("the claim query asks the taxonomy instead of naming pending", () => {
  const source = read("./whatsapp-product-extraction.ts");
  const claim = source.slice(
    source.indexOf("const jobs = await db.transaction"),
    source.indexOf("for (const job of jobs)"),
  );
  assert.ok(claim.length > 80, "the claim block moved; update this guard");
  assert.match(claim, /CLAIMABLE_JOB_STATUSES/);
  assert.doesNotMatch(
    claim,
    /eq\(\s*whatsappProductExtractionJobs\.status,\s*"pending"/,
    "the claim hard-codes `pending`, which re-opens every waiting state",
  );
  assert.match(claim, /lte\(\s*whatsappProductExtractionJobs\.nextRunAt/);
});

test("a re-check never starves fresh work", () => {
  // Making waits claimable has a cost: `limit(3)` is the entire throughput of the
  // queue, and a waiting job is, by definition, older than anything pending.
  // Reclaimed in `createdAt` order alone, thirteen parked jobs would spend every
  // pass re-deciding themselves and a merchant's new message would never be read.
  // So the claim serves `pending` first, and the priority is the module's
  // business — not a magic `case` someone copies.
  assert.equal(CLAIMABLE_JOB_STATUSES[0], FRESH_WORK_JOB_STATUS);
  assert.equal(FRESH_WORK_JOB_STATUS, "pending");

  const source = read("./whatsapp-product-extraction.ts");
  const claim = source.slice(
    source.indexOf("const jobs = await db.transaction"),
    source.indexOf("for (const job of jobs)"),
  );
  assert.match(claim, /orderBy\(/);
  assert.match(claim, /case when .*status.* = \$\{FRESH_WORK_JOB_STATUS\} then 0 else 1 end/);
  assert.match(claim, /asc\(whatsappProductExtractionJobs\.createdAt\)/);
});

test("both waits give the attempt back", () => {
  const source = read("./whatsapp-product-extraction.ts");
  for (const status of ["waiting_media", "waiting_association"]) {
    const at = source.indexOf(`status: "${status}",`);
    assert.ok(at > 0, `${status} is no longer written in words`);
    const block = source.slice(at, at + 900);
    assert.match(
      block,
      /attempts: sql`greatest\(/,
      `${status} spends an attempt, so waiting five minutes exhausts a job`,
    );
  }
});

test("settled media wakes the bundle, not only the message that finished", () => {
  // A bundle is one offer, and a job is keyed by one message. Reviving only the
  // settling message is what left six of thirteen parked forever.
  const source = read("./whatsapp-media-download.ts");
  const calls = source.match(/requeueWhatsAppProductBundle\(/g) ?? [];
  assert.equal(
    calls.length,
    3,
    "the media worker has three settle points, each must wake the bundle",
  );
  assert.doesNotMatch(
    source,
    /await requeueWhatsAppProductMessage\(/,
    "a settle point still wakes a single message's job",
  );
});

test("a text-only message is complete media", () => {
  // The gate used to read "no media rows" as "not ready", which made the
  // merchant's per-message button answer «لم تُضف رسالة جديدة» over a readable
  // offer.
  const source = read("./whatsapp-product-extraction.ts");
  const gate = source.slice(
    source.indexOf("async function hasCompleteWhatsAppProductMedia"),
    source.indexOf("export async function queueUnprocessedWhatsAppProductMessages"),
  );
  assert.ok(gate.length > 400, "the media gate moved; update this guard");
  const noRows = gate.indexOf("mediaRows.length === 0");
  assert.ok(noRows > 0, "the no-media case is no longer decided in words");
  const decision = gate.slice(noRows, noRows + 900);
  assert.match(
    decision,
    /return expectedCount === 0 && !mediaFailed && !mediaPending;/,
    "no media rows must be complete when nothing was expected, and refused " +
      "when an album promised photos that never arrived",
  );
});
