import assert from "node:assert/strict";
import test from "node:test";

import {
  executeSelfHealCycle,
  runSelfHealWithLock,
} from "./whatsapp-webhook-self-heal-policy.ts";

function logger() {
  const lines = [];
  const record = (level) => (fields, message) =>
    lines.push({ level, fields, message });
  return {
    lines,
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
  };
}

function probe(overrides = {}) {
  return {
    windowMs: 900_000,
    unknownInstanceNames: [],
    rejectedSecretCount: 0,
    lastRejectedAt: null,
    lastAcceptedAt: null,
    activeConnections: [
      {
        workspaceId: "ws-1",
        instanceName: "menaflow-active",
        phoneNumber: null,
      },
    ],
    ...overrides,
  };
}

function deps(overrides = {}) {
  const log = logger();
  const calls = { repair: 0, probe: 0, events: 0 };
  return {
    log,
    calls,
    value: {
      now: new Date("2026-11-25T20:05:00Z"),
      probeHealth: async () => {
        calls.probe += 1;
        return probe();
      },
      validateConfig: () => ({ valid: true, code: null }),
      repair: async () => {
        calls.repair += 1;
        return {
          repairStartedAt: new Date("2026-11-25T20:05:00Z"),
          deletedInstanceNames: [],
          reconfiguredInstanceNames: [],
        };
      },
      eventsSince: async () => {
        calls.events += 1;
        return [];
      },
      pendingVerifications: new Map(),
      lastReconfigureAt: new Map(),
      cooldownMs: 1_800_000,
      verifyWindowMs: 900_000,
      logger: log,
      ...overrides,
    },
  };
}

test("no issue means no repair call", async () => {
  const harness = deps();
  const result = await executeSelfHealCycle(harness.value);
  assert.equal(result.action, "none");
  assert.equal(harness.calls.repair, 0);
  assert.ok(harness.log.lines.some((line) => line.message === "WHATSAPP_SELF_HEAL_NO_ACTION"));
});

test("UNKNOWN_INSTANCE calls repair with a sweep plan", async () => {
  const harness = deps({
    probeHealth: async () =>
      probe({ unknownInstanceNames: ["menaflow-orphan"] }),
  });
  const result = await executeSelfHealCycle(harness.value);
  assert.equal(result.action, "sweep");
  assert.equal(harness.calls.repair, 1);
  assert.ok(
    harness.log.lines.some(
      (line) => line.message === "WHATSAPP_SELF_HEAL_REPAIR_STARTED",
    ),
  );
});

test("invalid configuration prevents a blind reconfigure", async () => {
  const harness = deps({
    validateConfig: () => ({ valid: false, code: "WHATSAPP_WEBHOOK_SECRET_REQUIRED" }),
    probeHealth: async () =>
      probe({
        rejectedSecretCount: 1,
        lastRejectedAt: new Date("2026-11-25T20:04:00Z"),
      }),
  });
  const result = await executeSelfHealCycle(harness.value);
  assert.equal(result.action, "none");
  assert.equal(harness.calls.repair, 0);
  assert.ok(
    harness.log.lines.some(
      (line) =>
        line.message === "WHATSAPP_SELF_HEAL_CONFIG_INVALID_NO_RECONFIGURE",
    ),
  );
});

test("cooldown prevents a second reconfigure", async () => {
  const harness = deps({
    lastReconfigureAt: new Map([
      ["menaflow-active", Date.parse("2026-11-25T20:00:00Z")],
    ]),
    probeHealth: async () =>
      probe({
        rejectedSecretCount: 1,
        lastRejectedAt: new Date("2026-11-25T20:04:00Z"),
      }),
  });
  const result = await executeSelfHealCycle(harness.value);
  assert.equal(result.action, "none");
  assert.equal(harness.calls.repair, 0);
});

test("a real accepted event closes a pending verification with PASS", async () => {
  const harness = deps({
    pendingVerifications: new Map([
      [
        "ws-1:menaflow-active",
        {
          workspaceId: "ws-1",
          instanceName: "menaflow-active",
          startedAt: Date.parse("2026-11-25T20:00:00Z"),
          toleratedInstanceNames: [],
        },
      ],
    ]),
    eventsSince: async () => [
      {
        event: "WHATSAPP_WEBHOOK_PROCESSED",
        instanceName: "menaflow-active",
        workspaceId: "ws-1",
        createdAt: new Date("2026-11-25T20:02:00Z"),
      },
    ],
  });
  const result = await executeSelfHealCycle(harness.value);
  assert.equal(result.verifications[0].state, "pass");
  assert.equal(harness.value.pendingVerifications.size, 0);
  assert.ok(
    harness.log.lines.some(
      (line) => line.message === "WHATSAPP_SELF_HEAL_VERIFIED",
    ),
  );
});

test("advisory lock lets only one cycle run at a time", async () => {
  let held = false;
  let runs = 0;
  const acquire = async () => {
    if (held) return false;
    held = true;
    return true;
  };
  const release = async () => {
    held = false;
  };
  const run = async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return runs;
  };
  const [first, second] = await Promise.all([
    runSelfHealWithLock(acquire, release, run),
    runSelfHealWithLock(acquire, release, run),
  ]);
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(runs, 1);
});
