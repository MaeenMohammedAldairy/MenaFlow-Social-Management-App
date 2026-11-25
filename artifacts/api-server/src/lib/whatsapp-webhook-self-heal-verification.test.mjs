import assert from "node:assert/strict";
import test from "node:test";

import { verifyWhatsAppRepair } from "./whatsapp-webhook-self-heal-policy.ts";

const startedAt = new Date("2026-11-25T20:00:00Z");
const now = Date.parse("2026-11-25T20:05:00Z");
const base = {
  repairStartedAt: startedAt,
  activeInstanceName: "menaflow-active",
  activeWorkspaceId: "ws-1",
  now,
  windowMs: 900_000,
};

function event(overrides = {}) {
  return {
    event: "WHATSAPP_WEBHOOK_PROCESSED",
    instanceName: "menaflow-active",
    workspaceId: "ws-1",
    createdAt: new Date("2026-11-25T20:02:00Z"),
    ...overrides,
  };
}

test("PROCESSED for the right workspace and instance after repair is pass", () => {
  const result = verifyWhatsAppRepair({ ...base, events: [event()] });
  assert.equal(result.state, "pass");
  assert.equal(result.evidence?.event, "WHATSAPP_WEBHOOK_PROCESSED");
  assert.equal(result.evidence?.instanceName, "menaflow-active");
  assert.equal(result.evidence?.workspaceId, "ws-1");
});

test("an accepted event from before the repair does not count", () => {
  const result = verifyWhatsAppRepair({
    ...base,
    events: [event({ createdAt: new Date("2026-11-25T19:59:59Z") })],
  });
  assert.equal(result.state, "pending");
});

test("an accepted event for another instance does not count", () => {
  const result = verifyWhatsAppRepair({
    ...base,
    events: [event({ instanceName: "menaflow-other" })],
  });
  assert.equal(result.state, "pending");
});

test("an accepted event for another workspace does not count", () => {
  const result = verifyWhatsAppRepair({
    ...base,
    events: [event({ workspaceId: "ws-2" })],
  });
  assert.equal(result.state, "pending");
});

test("no accepted event within the window is pending", () => {
  const result = verifyWhatsAppRepair({ ...base, events: [] });
  assert.equal(result.state, "pending");
});

test("no accepted event after the window is timeout", () => {
  const result = verifyWhatsAppRepair({
    ...base,
    now: Date.parse("2026-11-25T20:20:00Z"),
    events: [],
  });
  assert.equal(result.state, "timeout");
});

test("a newer rejection fails verification", () => {
  const result = verifyWhatsAppRepair({
    ...base,
    events: [
      event(),
      event({
        event: "WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE",
        instanceName: "menaflow-active",
        createdAt: new Date("2026-11-25T20:04:00Z"),
      }),
    ],
  });
  assert.equal(result.state, "fail");
});

test("stale in-flight rejections from deleted orphans are tolerated", () => {
  const result = verifyWhatsAppRepair({
    ...base,
    toleratedInstanceNames: ["menaflow-orphan"],
    events: [
      event(),
      event({
        event: "WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE",
        instanceName: "menaflow-orphan",
        createdAt: new Date("2026-11-25T20:01:00Z"),
      }),
    ],
  });
  assert.equal(result.state, "pass");
});
