import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SELF_HEAL_RECONFIGURE_COOLDOWN_MS,
  planWhatsAppWebhookRepair,
} from "./whatsapp-webhook-self-heal-policy.ts";

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
        phoneNumber: "967777000000",
      },
    ],
    ...overrides,
  };
}

function plan(input) {
  return planWhatsAppWebhookRepair({
    now: Date.parse("2026-11-25T20:00:00Z"),
    configurationValid: true,
    lastReconfigureAt: null,
    cooldownMs: DEFAULT_SELF_HEAL_RECONFIGURE_COOLDOWN_MS,
    ...input,
  });
}

test("no problem means no action and no Evolution write", () => {
  const result = plan({ probe: probe() });
  assert.equal(result.action, "none");
  assert.equal(result.needsSweep, false);
  assert.equal(result.needsReconfigure, false);
  assert.deepEqual(result.reasons, ["NO_SIGNAL"]);
});

test("no active connection means no action", () => {
  const result = plan({ probe: probe({ activeConnections: [] }) });
  assert.equal(result.action, "none");
  assert.deepEqual(result.reasons, ["NO_ACTIVE_CONNECTION"]);
});

test("UNKNOWN_INSTANCE schedules only the sweep", () => {
  const result = plan({
    probe: probe({ unknownInstanceNames: ["menaflow-orphan"] }),
  });
  assert.equal(result.action, "sweep");
  assert.equal(result.needsSweep, true);
  assert.equal(result.needsReconfigure, false);
});

test("REJECTED_SECRET with valid configuration schedules reconfigure", () => {
  const result = plan({
    probe: probe({
      rejectedSecretCount: 3,
      lastRejectedAt: new Date("2026-11-25T19:59:00Z"),
    }),
  });
  assert.equal(result.action, "reconfigure");
  assert.equal(result.needsReconfigure, true);
  assert.equal(result.needsSweep, false);
});

test("REJECTED_SECRET with invalid configuration is never repaired blindly", () => {
  const result = plan({
    configurationValid: false,
    probe: probe({
      rejectedSecretCount: 1,
      lastRejectedAt: new Date("2026-11-25T19:59:00Z"),
    }),
  });
  assert.equal(result.action, "none");
  assert.equal(result.needsReconfigure, false);
  assert.ok(result.reasons.includes("CONFIG_INVALID_NO_RECONFIGURE"));
});

test("cooldown blocks a repeated reconfigure", () => {
  const result = plan({
    lastReconfigureAt: Date.parse("2026-11-25T19:50:00Z"),
    probe: probe({
      rejectedSecretCount: 1,
      lastRejectedAt: new Date("2026-11-25T19:59:00Z"),
    }),
  });
  assert.equal(result.action, "none");
  assert.equal(result.needsReconfigure, false);
  assert.ok(result.reasons.includes("RECONFIGURE_COOLDOWN"));
});

test("unknown instance plus rejected secret schedules both repairs", () => {
  const result = plan({
    probe: probe({
      unknownInstanceNames: ["menaflow-orphan"],
      rejectedSecretCount: 1,
      lastRejectedAt: new Date("2026-11-25T19:59:00Z"),
    }),
  });
  assert.equal(result.action, "sweep_and_reconfigure");
  assert.equal(result.needsSweep, true);
  assert.equal(result.needsReconfigure, true);
});

test("a rejection followed by a newer accepted event is recovered", () => {
  const result = plan({
    probe: probe({
      rejectedSecretCount: 1,
      lastRejectedAt: new Date("2026-11-25T19:50:00Z"),
      lastAcceptedAt: new Date("2026-11-25T19:58:00Z"),
    }),
  });
  assert.equal(result.action, "none");
  assert.ok(result.reasons.includes("RECOVERED"));
});
