import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionSourceCount,
  connectedSourceCount,
  isSourceConnected,
  metaReauthorizationReason,
  sourceDetail,
  sourceStatus,
} from "./sources-status.ts";

const LOADED = { isLoading: false };
const LOADING = { isLoading: true };

const READY_META = {
  facebook: { authorizationStatus: "ready", accountName: "متجر منى" },
  instagram: { authorizationStatus: "ready", accountName: "mona.store" },
};
const CONNECTED_WHATSAPP = {
  whatsapp: { connectionState: "connected", accountName: "+966561234567" },
};

test("the two platform families report readiness differently", () => {
  // Meta speaks in authorizationStatus, the WhatsApp provider in connectionState.
  // Reading the wrong field is a card that says "متصل" for a dead session.
  assert.equal(isSourceConnected(READY_META, "facebook"), true);
  assert.equal(isSourceConnected(READY_META, "instagram"), true);
  assert.equal(isSourceConnected(READY_META, "whatsapp"), false);
  assert.equal(isSourceConnected(CONNECTED_WHATSAPP, "whatsapp"), true);
  assert.equal(isSourceConnected(CONNECTED_WHATSAPP, "facebook"), false);
  assert.equal(isSourceConnected(null, "whatsapp"), false);
  assert.equal(isSourceConnected(undefined, "facebook"), false);
});

test("while the connections are unknown no card claims a state", () => {
  for (const key of ["facebook", "instagram", "whatsapp"]) {
    assert.equal(sourceStatus(READY_META, key, LOADING), "جارٍ التحقق…");
    assert.equal(sourceDetail(READY_META, key, LOADING), null);
  }
});

test("a source that was never linked reads as not linked", () => {
  assert.equal(sourceStatus({}, "whatsapp", LOADED), "غير مربوط");
  assert.equal(sourceStatus({}, "facebook", LOADED), "غير مربوط");
  assert.equal(sourceDetail({}, "whatsapp", LOADED), null);
});

test("WhatsApp is described only by functional state, never internal mechanism", () => {
  const cases = [
    ["connected", "متصل", "واتساب يعمل بشكل طبيعي"],
    ["connecting", "جارٍ التحقق…", "يتم التحقق من الاتصال تلقائيًا."],
    ["unavailable", "جارٍ الإصلاح", "نعمل على إصلاح اتصال واتساب تلقائيًا."],
    ["failed", "جارٍ الإصلاح", "نعمل على إصلاح اتصال واتساب تلقائيًا."],
    ["missing", "جارٍ الإصلاح", "نعمل على إصلاح اتصال واتساب تلقائيًا."],
    ["disconnected", "جارٍ الإصلاح", "نعمل على إصلاح اتصال واتساب تلقائيًا."],
  ];
  for (const [connectionState, status, detail] of cases) {
    const connections = { whatsapp: { connectionState, accountName: "+966561234567" } };
    assert.equal(sourceStatus(connections, "whatsapp", LOADED), status, connectionState);
    assert.equal(sourceDetail(connections, "whatsapp", LOADED), detail, connectionState);
    assert.equal(isSourceConnected(connections, "whatsapp"), connectionState === "connected");
    for (const term of ["Evolution", "Instance", "مثيل", "Webhook", "ويب هوك"]) {
      assert.equal(detail.includes(term), false, `${detail} must not contain ${term}`);
    }
  }
});

test("a Meta connection needing re-authorisation says why", () => {
  const cases = [
    ["token_expired", "انتهت صلاحية رمز Meta."],
    ["token_invalid", "رمز Meta غير صالح أو مرفوض."],
    ["permissions_changed", "صلاحيات Meta تحتاج إلى تحقق."],
    [null, "صلاحيات Meta تحتاج إلى تحقق."],
  ];
  for (const [authorizationReason, expected] of cases) {
    const connections = {
      instagram: {
        authorizationStatus: "needs_reauthorization",
        authorizationReason,
        accountName: "mona.store",
      },
    };
    assert.equal(
      metaReauthorizationReason(connections, "instagram"),
      expected,
      String(authorizationReason),
    );
    assert.equal(sourceStatus(connections, "instagram", LOADED), "يحتاج إعادة تفويض");
    assert.equal(sourceDetail(connections, "instagram", LOADED), expected);
  }
});

test("a connected Meta account shows its identity, per platform", () => {
  assert.equal(sourceDetail(READY_META, "facebook", LOADED), "صفحة: متجر منى");
  assert.equal(sourceDetail(READY_META, "instagram", LOADED), "@mona.store");
});

test("a missing account name never prints the word null to a merchant", () => {
  const connections = {
    facebook: { authorizationStatus: "ready", accountName: null },
    whatsapp: { connectionState: "connected", accountName: undefined },
  };
  assert.equal(sourceDetail(connections, "facebook", LOADED), "صفحة: ");
  assert.equal(sourceDetail(connections, "whatsapp", LOADED), "واتساب يعمل بشكل طبيعي");
});

test("only a saved-but-broken source counts as needing attention", () => {
  // A merchant who has not started with WhatsApp has nothing to fix; counting the
  // absent connection would pin a permanent warning on their header.
  assert.equal(attentionSourceCount({}), 0);
  assert.equal(attentionSourceCount(CONNECTED_WHATSAPP), 0);
  assert.equal(attentionSourceCount({ whatsapp: { connectionState: "failed" } }), 1);
  assert.equal(attentionSourceCount({ whatsapp: { connectionState: "missing" } }), 1);
  assert.equal(connectedSourceCount(CONNECTED_WHATSAPP), 1);
  assert.equal(connectedSourceCount({ whatsapp: { connectionState: "failed" } }), 0);
});
