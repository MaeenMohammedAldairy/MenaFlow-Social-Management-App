import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  planOrphanInstanceCleanup,
} from "./whatsapp-orphan-instance-policy.ts";
import { describeWhatsAppInboundOutcome } from "./inbound-webhook-diagnostics.ts";
import { decideWhatsAppPhoneOwnership } from "./whatsapp-phone-ownership.ts";

const phoneDigits = "967777187184";

test("a duplicate phone never turns a claimed instance into a delete target", () => {
  const plan = planOrphanInstanceCleanup({
    instances: [
      {
        instanceName: "menaflow-aaaaaaaaaaaa",
        phoneNumber: phoneDigits,
        connectionStatus: "open",
      },
      {
        instanceName: "menaflow-bbbbbbbbbbbb",
        phoneNumber: phoneDigits,
        connectionStatus: "open",
      },
    ],
    keepInstanceName: null,
    claimedInstanceNames: [
      "menaflow-aaaaaaaaaaaa",
      "menaflow-bbbbbbbbbbbb",
    ],
    // Scheduled sweeps deliberately omit the phone number.
    phoneNumber: null,
  });

  assert.equal(plan.toDelete.length, 0);
  assert.equal(plan.skipped.length, 2);
  assert.ok(
    plan.skipped.every((entry) => entry.reason === "CLAIMED_BY_WORKSPACE"),
  );
});

test("self-heal cannot choose an owner from a conflicting active state", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: phoneDigits,
    currentWorkspaceId: "workspace-b",
    rows: [
      { workspaceId: "workspace-b", status: "connected" },
      { workspaceId: "workspace-a", status: "connecting" },
    ],
  });
  // It reports the conflict for the caller to resolve safely; it never
  // returns an "available" result that would let a sweep or repair pick a side.
  assert.equal(decision.status, "owned_elsewhere");
});

test("an event from an inactive session is observable but reveals no internals", () => {
  const outcome = describeWhatsAppInboundOutcome("INACTIVE_CONNECTION");
  assert.equal(outcome.level, "warn");
  assert.equal(outcome.deliveryConfirmed, true);
  assert.equal(
    outcome.event,
    "WHATSAPP_WEBHOOK_INACTIVE_CONNECTION",
  );
  for (const secret of [
    "workspace_id",
    "instanceName",
    "phoneNumber",
    "secret",
  ]) {
    assert.equal(outcome.hint.includes(secret), false);
  }
});

test("the migration encodes canonical digits and a partial active-only index", () => {
  const sql = readFileSync(
    new URL(
      "../../../../supabase/migrations/20261126000000_whatsapp_phone_digits_ownership.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /translate\(coalesce\(phone_number/);
  assert.match(sql, /\^00\(\?=\[1-9\]\)/);
  assert.match(sql, /GENERATED ALWAYS AS/);
  assert.match(sql, /CREATE UNIQUE INDEX mena_whatsapp_connections_active_phone_key/);
  assert.match(sql, /status IN \('connecting', 'connected'\)/);
  assert.match(sql, /RAISE EXCEPTION/);
});
