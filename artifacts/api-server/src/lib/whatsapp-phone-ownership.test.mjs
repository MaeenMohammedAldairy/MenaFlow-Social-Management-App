import assert from "node:assert/strict";
import test from "node:test";

import {
  decideWhatsAppPhoneOwnership,
  normalizeWhatsAppPhoneDigits,
  WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE,
  WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE_MESSAGE,
  isActiveWhatsAppConnectionStatus,
} from "./whatsapp-phone-ownership.ts";

test("normalization follows the existing E.164 policy", () => {
  const expected = "967777187184";
  for (const value of [
    "+967777187184",
    "967777187184",
    "+967 777 187 184",
    "00967 777 187 184",
    "+٩٦٧٧٧٧١٨٧١٨٤",
    "+۹۶۷۷۷۷۱۸۷۱۸۴",
  ]) {
    assert.equal(normalizeWhatsAppPhoneDigits(value), expected, value);
  }
});

test("invalid values normalize to null", () => {
  for (const value of ["", "abc", "+0123", "12345", null, 123]) {
    assert.equal(normalizeWhatsAppPhoneDigits(value), null, String(value));
  }
});

test("only connecting and connected grant active ownership", () => {
  assert.equal(isActiveWhatsAppConnectionStatus("connecting"), true);
  assert.equal(isActiveWhatsAppConnectionStatus("connected"), true);
  assert.equal(isActiveWhatsAppConnectionStatus("disconnected"), false);
  assert.equal(isActiveWhatsAppConnectionStatus("failed"), false);
  assert.equal(isActiveWhatsAppConnectionStatus(null), false);
});

test("no rows means the number is available", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: "967777187184",
    currentWorkspaceId: "B",
    rows: [],
  });
  assert.equal(decision.status, "available");
});

test("same workspace active row is not a cross-workspace conflict", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: "967777187184",
    currentWorkspaceId: "A",
    rows: [{ workspaceId: "A", status: "connected" }],
  });
  assert.equal(decision.status, "same_workspace");
});

test("another workspace's connected row blocks the number", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: "967777187184",
    currentWorkspaceId: "B",
    rows: [{ workspaceId: "A", status: "connected" }],
  });
  assert.equal(decision.status, "owned_elsewhere");
  assert.equal(decision.code, WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE);
  assert.equal(decision.message, WHATSAPP_NUMBER_OWNED_BY_ANOTHER_WORKSPACE_MESSAGE);
});

test("another workspace's connecting row also blocks the number", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: "967777187184",
    currentWorkspaceId: "B",
    rows: [{ workspaceId: "A", status: "connecting" }],
  });
  assert.equal(decision.status, "owned_elsewhere");
});

test("disconnected and failed rows never grant ownership", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: "967777187184",
    currentWorkspaceId: "B",
    rows: [
      { workspaceId: "A", status: "disconnected" },
      { workspaceId: "A", status: "failed" },
    ],
  });
  assert.equal(decision.status, "available");
});

test("an active row elsewhere wins over an active row here", () => {
  const decision = decideWhatsAppPhoneOwnership({
    digits: "967777187184",
    currentWorkspaceId: "B",
    rows: [
      { workspaceId: "B", status: "connected" },
      { workspaceId: "A", status: "connecting" },
    ],
  });
  assert.equal(decision.status, "owned_elsewhere");
});
