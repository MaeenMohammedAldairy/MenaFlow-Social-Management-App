import assert from "node:assert/strict";
import test from "node:test";

import {
  WHATSAPP_REPAIRING_MESSAGE,
  WHATSAPP_WORKING_MESSAGE,
  whatsAppFunctionalStatus,
} from "./whatsapp-functional-status.ts";

const forbiddenTerms = [
  "Self-Healing",
  "self-heal",
  "Webhook",
  "ويب هوك",
  "Evolution",
  "Instance",
  "مثيل",
  "workspace_id",
  "instanceName",
  "log",
  "secret",
];

test("a healthy connection shows only the functional success sentence", () => {
  const status = whatsAppFunctionalStatus({
    connected: true,
    inbound: { deliveryConfirmed: true, issues: [] },
  });
  assert.deepEqual(status, {
    label: "متصل",
    tone: "green",
    message: WHATSAPP_WORKING_MESSAGE,
  });
});

test("a new quiet account is healthy, not a false repair alarm", () => {
  const status = whatsAppFunctionalStatus({
    connected: true,
    inbound: { deliveryConfirmed: false, issues: [] },
  });
  assert.equal(status.message, WHATSAPP_WORKING_MESSAGE);
});

test("a real critical inbound fault promises automatic repair only", () => {
  const status = whatsAppFunctionalStatus({
    connected: true,
    inbound: {
      deliveryConfirmed: false,
      issues: [{ severity: "critical", code: "WHATSAPP_WEBHOOK_SECRET_MISSING" }],
    },
  });
  assert.deepEqual(status, {
    label: "جارٍ الإصلاح",
    tone: "amber",
    message: WHATSAPP_REPAIRING_MESSAGE,
  });
});

test("a warning-level note does not claim the system is repairing", () => {
  const status = whatsAppFunctionalStatus({
    connected: true,
    inbound: {
      deliveryConfirmed: true,
      issues: [{ severity: "warning", code: "WHATSAPP_NO_INBOUND_EVENTS" }],
    },
  });
  assert.equal(status.message, WHATSAPP_WORKING_MESSAGE);
});

test("merchant copy never names the internal mechanism", () => {
  const states = [
    whatsAppFunctionalStatus({ connected: true, inbound: null }),
    whatsAppFunctionalStatus({
      connected: true,
      inbound: { issues: [{ severity: "critical" }] },
    }),
  ];
  for (const state of states) {
    for (const value of [state.label, state.message]) {
      for (const term of forbiddenTerms) {
        assert.equal(
          value.toLowerCase().includes(term.toLowerCase()),
          false,
          `${value} must not contain ${term}`,
        );
      }
    }
  }
});
