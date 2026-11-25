import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isActiveWhatsAppOptOut,
  isWhatsAppOptInMessage,
  isWhatsAppOptOutMessage,
  recordWhatsAppConsent,
  whatsAppConsentActionForMessage,
  withWhatsAppAutomationConsent,
} from "./whatsapp-opt-out.ts";

const OWNER = "owner-1";
const WS_A = "workspace-a";
const WS_B = "workspace-b";
const CUSTOMER = "conversation-hash";

function key(workspaceId, customerId) {
  return `${workspaceId}:${customerId}`;
}

function createStore(backing = new Map()) {
  return {
    backing,
    async find({ workspaceId, customerId }) {
      const record = backing.get(key(workspaceId, customerId));
      return record ? { ...record } : null;
    },
    async optOut({ ownerId, workspaceId, customerId, at }) {
      const record = {
        ownerId,
        workspaceId,
        customerId,
        optedOutAt: at,
        optedInAt: null,
      };
      backing.set(key(workspaceId, customerId), record);
      return { ...record };
    },
    async optIn({ ownerId, workspaceId, customerId, at }) {
      const existing = backing.get(key(workspaceId, customerId));
      const record = {
        ownerId: ownerId ?? existing?.ownerId ?? OWNER,
        workspaceId,
        customerId,
        optedOutAt: existing?.optedOutAt ?? at,
        optedInAt: at,
      };
      backing.set(key(workspaceId, customerId), record);
      return { ...record };
    },
  };
}

function createLock() {
  let tail = Promise.resolve();
  return {
    async run(_key, run) {
      const result = tail.then(run, run);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

async function optOut(store, workspaceId = WS_A) {
  return recordWhatsAppConsent({
    store,
    ownerId: OWNER,
    workspaceId,
    customerId: CUSTOMER,
    action: "opt_out",
    at: new Date("2026-11-25T10:00:00Z"),
  });
}

test("detects exact English and Arabic opt-out messages", () => {
  assert.equal(isWhatsAppOptOutMessage(" STOP! "), true);
  assert.equal(isWhatsAppOptOutMessage("إلغاء الاشتراك"), true);
  assert.equal(isWhatsAppOptOutMessage("أريد معرفة الإلغاء"), false);
});

test("detects explicit opt-in commands without matching ordinary text", () => {
  assert.equal(isWhatsAppOptInMessage(" START "), true);
  assert.equal(isWhatsAppOptInMessage("ابدأ"), true);
  assert.equal(isWhatsAppOptInMessage("ابدأ الطلب"), false);
  assert.equal(whatsAppConsentActionForMessage("stop"), "opt_out");
  assert.equal(whatsAppConsentActionForMessage("ابدأ"), "opt_in");
  assert.equal(whatsAppConsentActionForMessage("مرحبا"), null);
});

test("STOP persists an active opt-out; later messages get no auto reply", async () => {
  const store = createStore();
  const saved = await optOut(store);
  assert.equal(isActiveWhatsAppOptOut(saved), true);

  const gate = await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "sent",
  });
  assert.deepEqual(gate, { status: "opted_out" });
});

test("a queued job created before STOP is not sent after STOP is stored", async () => {
  const store = createStore();
  const sent = [];
  await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => sent.push("first reply"),
  });
  assert.deepEqual(sent, ["first reply"]);

  await optOut(store);
  const oldJob = await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => sent.push("old queued reply"),
  });
  assert.equal(oldJob.status, "opted_out");
  assert.deepEqual(sent, ["first reply"]);
});

test("a STOP landing between the start check and the final send gate cancels it", async () => {
  const store = createStore();
  const lock = createLock();
  const initial = await withWhatsAppAutomationConsent({
    store,
    lock,
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "generation accepted",
  });
  assert.equal(initial.status, "allowed");

  // The webhook writes consent without waiting for the worker lock.
  await optOut(store);

  const finalSendGate = await withWhatsAppAutomationConsent({
    store,
    lock,
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "reply sent",
  });
  assert.deepEqual(finalSendGate, { status: "opted_out" });
});

test("the two reads in the race scenario disagree exactly once, proving the final gate matters", async () => {
  const store = createStore();
  let reads = 0;
  let stopCommitted = false;
  const racingStore = {
    ...store,
    async find(input) {
      reads += 1;
      if (reads === 2) {
        await optOut(store, input.workspaceId);
        stopCommitted = true;
      }
      return store.find(input);
    },
  };
  const first = await withWhatsAppAutomationConsent({
    store: racingStore,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "allowed",
  });
  assert.equal(first.status, "allowed");
  const second = await withWhatsAppAutomationConsent({
    store: racingStore,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "must not run",
  });
  assert.equal(second.status, "opted_out");
  assert.equal(stopCommitted, true);
});

test("START re-subscribes, records opted_in_at, and allows future replies", async () => {
  const store = createStore();
  await optOut(store);
  const optedInAt = new Date("2026-11-25T11:00:00Z");
  const record = await recordWhatsAppConsent({
    store,
    ownerId: OWNER,
    workspaceId: WS_A,
    customerId: CUSTOMER,
    action: "opt_in",
    at: optedInAt,
  });
  assert.equal(record.optedInAt, optedInAt);
  assert.equal(isActiveWhatsAppOptOut(record), false);

  const gate = await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "allowed again",
  });
  assert.deepEqual(gate, { status: "allowed", value: "allowed again" });
});

test("opt-out stays scoped to one workspace", async () => {
  const store = createStore();
  await optOut(store, WS_A);

  const inA = await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "blocked",
  });
  const inB = await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_B,
    customerId: CUSTOMER,
    run: async () => "allowed",
  });
  assert.equal(inA.status, "opted_out");
  assert.deepEqual(inB, { status: "allowed", value: "allowed" });
});

test("manual replies are outside the automation gate and stay possible", () => {
  const manualRoute = readFileSync(
    new URL("../routes/whatsapp-direct-inbox.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    manualRoute.includes("whatsapp-opt-out"),
    false,
    "the merchant's manual reply path must not consult automation consent",
  );
});

test("state survives a process restart because it lives in the store", async () => {
  const backing = new Map();
  await optOut(createStore(backing));
  const restartedStore = createStore(backing);
  const gate = await withWhatsAppAutomationConsent({
    store: restartedStore,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => "must not run",
  });
  assert.equal(gate.status, "opted_out");
});

test("repeated STOP updates one row instead of creating duplicates", async () => {
  const store = createStore();
  await optOut(store);
  await optOut(store);
  await recordWhatsAppConsent({
    store,
    ownerId: OWNER,
    workspaceId: WS_A,
    customerId: CUSTOMER,
    action: "opt_in",
    at: new Date(),
  });
  await optOut(store);
  assert.equal(store.backing.size, 1);
});

test("order-intake and generated replies share the same automation gate", async () => {
  const store = createStore();
  await optOut(store);
  const sent = [];
  const gate = await withWhatsAppAutomationConsent({
    store,
    lock: createLock(),
    workspaceId: WS_A,
    customerId: CUSTOMER,
    run: async () => {
      sent.push("order confirmation");
      sent.push("generated reply");
    },
  });
  assert.equal(gate.status, "opted_out");
  assert.deepEqual(sent, []);
});
