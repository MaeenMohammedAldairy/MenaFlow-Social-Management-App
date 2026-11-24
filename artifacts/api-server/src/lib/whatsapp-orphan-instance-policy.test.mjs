import assert from "node:assert/strict";
import test from "node:test";

import {
  MENAFLOW_INSTANCE_PREFIX,
  ORPHAN_INSTANCE_CLEANUP_LIMIT,
  isMenaFlowInstanceName,
  parseEvolutionInstanceList,
  planOrphanInstanceCleanup,
  whatsappPhoneDigits,
} from "./whatsapp-orphan-instance-policy.ts";

/**
 * Deleting an Evolution instance unlinks a WhatsApp session, so these tests are
 * written from the direction of harm: each one names a thing the sweep must NOT
 * delete, and the production scenario that motivated it is asserted last.
 */

const PHONE = "967777187184";

function instance(overrides = {}) {
  return {
    instanceName: "menaflow-a898bc54ab23",
    phoneNumber: PHONE,
    connectionStatus: "open",
    ...overrides,
  };
}

function plan(instances, overrides = {}) {
  return planOrphanInstanceCleanup({
    instances,
    keepInstanceName: "menaflow-3c247db8a54d",
    claimedInstanceNames: [],
    phoneNumber: PHONE,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Parsing Evolution's response.
// ---------------------------------------------------------------------------

test("parses the flat array shape", () => {
  assert.deepEqual(
    parseEvolutionInstanceList([
      { name: "menaflow-a898bc54ab23", number: "+967 777 187 184", connectionStatus: "open" },
    ]),
    [instance()],
  );
});

test("parses an item wrapped in its own instance object", () => {
  assert.deepEqual(
    parseEvolutionInstanceList({
      instance: [
        { instance: { instanceName: "menaflow-a898bc54ab23", number: PHONE, state: "OPEN" } },
      ],
    }),
    [instance()],
  );
});

test("parses data and instances wrappers", () => {
  // Neither wrapper carries a status here, so it normalizes to null.
  const expected = [instance({ connectionStatus: null })];
  assert.deepEqual(
    parseEvolutionInstanceList({ data: [{ name: instance().instanceName, number: PHONE }] }),
    expected,
  );
  assert.deepEqual(
    parseEvolutionInstanceList({
      instances: [{ instanceName: instance().instanceName, phoneNumber: PHONE }],
    }),
    expected,
  );
});

test("drops items it cannot name instead of guessing", () => {
  assert.deepEqual(
    parseEvolutionInstanceList([
      { number: PHONE },
      { name: "   " },
      null,
      "menaflow-a898bc54ab23",
      { name: "menaflow-a898bc54ab23", number: PHONE },
    ]),
    [instance({ connectionStatus: null })],
  );
});

test("returns nothing for a payload that is not a list", () => {
  for (const payload of [null, undefined, {}, { instance: {} }, "[]", 42]) {
    assert.deepEqual(parseEvolutionInstanceList(payload), [], JSON.stringify(payload));
  }
});

test("reports an unknown number and status as null rather than empty strings", () => {
  assert.deepEqual(parseEvolutionInstanceList([{ name: "menaflow-x" }]), [
    { instanceName: "menaflow-x", phoneNumber: null, connectionStatus: null },
  ]);
});

// ---------------------------------------------------------------------------
// Phone comparison.
// ---------------------------------------------------------------------------

test("compares phone numbers by digits only", () => {
  assert.equal(whatsappPhoneDigits("+967 777-187 184"), PHONE);
  assert.equal(whatsappPhoneDigits("00967777187184") === PHONE, false);
  assert.equal(whatsappPhoneDigits(null), null);
  assert.equal(whatsappPhoneDigits("+()"), null);
});

test("recognises only names this app creates", () => {
  assert.equal(isMenaFlowInstanceName(`${MENAFLOW_INSTANCE_PREFIX}a898bc54ab23`), true);
  assert.equal(isMenaFlowInstanceName("menaflowa898bc54ab23"), false);
  assert.equal(isMenaFlowInstanceName("MenaFlow-a898bc54ab23"), false);
});

// ---------------------------------------------------------------------------
// What the sweep must not delete.
// ---------------------------------------------------------------------------

test("never deletes the instance being connected or repaired", () => {
  const result = plan([instance({ instanceName: "menaflow-3c247db8a54d" })]);
  assert.deepEqual(result.toDelete, []);
  assert.deepEqual(
    result.skipped.map((entry) => entry.reason),
    ["KEEP_ACTIVE_INSTANCE"],
  );
});

test("never deletes a name another workspace's connection row claims", () => {
  // This is the duplicate-workspace case: the same phone bound to a second
  // workspace that still has a row. Force is the wrong answer — an operator
  // disconnects it — so it is reported, not deleted.
  const result = plan([instance({ instanceName: "menaflow-31d5ea2ce122" })], {
    claimedInstanceNames: new Set(["menaflow-31d5ea2ce122"]),
  });
  assert.deepEqual(result.toDelete, []);
  assert.deepEqual(
    result.skipped.map((entry) => entry.reason),
    ["CLAIMED_BY_WORKSPACE"],
  );
});

test("never deletes an instance bound to a different phone number", () => {
  const result = plan([instance({ phoneNumber: "967700000000" })]);
  assert.deepEqual(result.toDelete, []);
  assert.deepEqual(
    result.skipped.map((entry) => entry.reason),
    ["PHONE_NUMBER_MISMATCH"],
  );
});

test("never deletes an instance it did not create", () => {
  // An Evolution server can host other applications' instances. Their names do
  // not carry our prefix, and no claim list in this database would mention them.
  const result = plan([
    instance({ instanceName: "some-other-app" }),
    instance({ instanceName: "client-support-bot" }),
  ]);
  assert.deepEqual(result.toDelete, []);
  assert.deepEqual(
    result.skipped.map((entry) => entry.reason),
    ["NOT_CREATED_BY_MENAFLOW", "NOT_CREATED_BY_MENAFLOW"],
  );
});

test("deletes an unclaimed instance whose number Evolution did not report", () => {
  // Naming is deterministic per workspace, so an unclaimed `menaflow-*` instance
  // can only be the leftover of a workspace that no longer exists — which is the
  // case the sweep exists for. Requiring a number here would skip exactly the
  // orphan observed in production.
  const result = plan([instance({ phoneNumber: null })]);
  assert.deepEqual(result.toDelete.map((entry) => entry.instanceName), [
    "menaflow-a898bc54ab23",
  ]);
  assert.deepEqual(result.skipped, []);
});

test("caps one run and reports the remainder", () => {
  const orphans = Array.from({ length: 9 }, (_, index) =>
    instance({ instanceName: `menaflow-orphan${index}` }),
  );
  const result = plan(orphans);
  assert.equal(result.toDelete.length, ORPHAN_INSTANCE_CLEANUP_LIMIT);
  assert.equal(result.skipped.length, 9 - ORPHAN_INSTANCE_CLEANUP_LIMIT);
  assert.ok(
    result.skipped.every((entry) => entry.reason === "CLEANUP_LIMIT_REACHED"),
    "every instance past the cap is reported, not silently dropped",
  );
});

test("a requested limit cannot exceed the built-in cap", () => {
  const orphans = Array.from({ length: 9 }, (_, index) =>
    instance({ instanceName: `menaflow-orphan${index}` }),
  );
  assert.equal(plan(orphans, { limit: 500 }).toDelete.length, ORPHAN_INSTANCE_CLEANUP_LIMIT);
  for (const limit of [0, -1, 1.5, Number.NaN]) {
    assert.equal(
      plan(orphans, { limit }).toDelete.length,
      ORPHAN_INSTANCE_CLEANUP_LIMIT,
      `limit ${limit} falls back to the cap`,
    );
  }
  assert.equal(plan(orphans, { limit: 2 }).toDelete.length, 2);
});

// ---------------------------------------------------------------------------
// The production scenario.
// ---------------------------------------------------------------------------

test("sweeps the orphan that held the merchant's live session", () => {
  // Production, 2026-11-24: workspace `c1db5069…` connected as
  // `menaflow-3c247db8a54d`, a duplicate workspace `317629cc…` held a
  // disconnected row for `menaflow-31d5ea2ce122` on the same phone, and every
  // inbound event arrived from `menaflow-a898bc54ab23` — the instance of a
  // workspace id that no longer exists — where it was refused as
  // `WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE`.
  const result = plan(
    [
      instance({ instanceName: "menaflow-3c247db8a54d", connectionStatus: "open" }),
      instance({ instanceName: "menaflow-31d5ea2ce122", connectionStatus: "close" }),
      instance({ instanceName: "menaflow-a898bc54ab23", connectionStatus: "open" }),
      instance({ instanceName: "unrelated-tenant", connectionStatus: "open" }),
    ],
    { claimedInstanceNames: ["menaflow-31d5ea2ce122"] },
  );

  assert.deepEqual(result.toDelete.map((entry) => entry.instanceName), [
    "menaflow-a898bc54ab23",
  ]);
  assert.deepEqual(
    result.skipped.map((entry) => [entry.instance.instanceName, entry.reason]),
    [
      ["menaflow-3c247db8a54d", "KEEP_ACTIVE_INSTANCE"],
      ["menaflow-31d5ea2ce122", "CLAIMED_BY_WORKSPACE"],
      ["unrelated-tenant", "NOT_CREATED_BY_MENAFLOW"],
    ],
  );
});

test("an already clean server produces no deletions", () => {
  const result = plan([instance({ instanceName: "menaflow-3c247db8a54d" })]);
  assert.deepEqual(result.toDelete, []);
  assert.equal(result.skipped.length, 1);
});
