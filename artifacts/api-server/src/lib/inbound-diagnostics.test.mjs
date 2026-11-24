import assert from "node:assert/strict";
import test from "node:test";
import {
  metaInboundDiagnostics,
  whatsAppInboundDiagnostics,
} from "./inbound-diagnostics.ts";

const lastMessage = new Date("2026-11-24T02:20:00.000Z");

function whatsAppInput(overrides = {}) {
  return {
    lastDirectMessageAt: lastMessage,
    directMessageCount: 4,
    autoReplyEventCounts: [
      { status: "queued", total: 2 },
      { status: "processing", total: 1 },
      { status: "sent", total: 5 },
      { status: "failed", total: 1 },
      { status: "sending", total: 1 },
      { status: "unknown", total: 2 },
    ],
    webhookSecretConfigured: true,
    webhookUrl: "https://api.example.test/api/social/whatsapp/webhook",
    webhookUrlError: null,
    ...overrides,
  };
}

function metaInput(overrides = {}) {
  return {
    lastInboxItemAt: lastMessage,
    inboxItemCount: 3,
    inboxCountsByPlatform: [
      { platform: "facebook", total: 2 },
      { platform: "instagram", total: 1 },
    ],
    autoReplyJobCounts: [
      { status: "queued", total: 1 },
      { status: "completed", total: 2 },
      { status: "failed", total: 1 },
      { status: "skipped", total: 3 },
    ],
    subscriptions: [
      {
        platform: "facebook",
        accountId: "100105546131276",
        subscribedFields: ["feed", "messages"],
        subscribedAt: lastMessage,
        lastErrorCode: null,
      },
      {
        platform: "instagram",
        accountId: "17841415814930227",
        subscribedFields: ["comments", "messages"],
        subscribedAt: lastMessage,
        lastErrorCode: null,
      },
    ],
    verifyTokenConfigured: true,
    appSecretConfigured: true,
    ...overrides,
  };
}

test("a healthy WhatsApp inbound path reports delivery and no issues", () => {
  const diagnostics = whatsAppInboundDiagnostics(whatsAppInput());
  assert.equal(diagnostics.deliveryConfirmed, true);
  assert.equal(diagnostics.lastDirectMessageAt, "2026-11-24T02:20:00.000Z");
  assert.equal(diagnostics.directMessageCount, 4);
  assert.deepEqual(diagnostics.autoReplyEvents, {
    queued: 4,
    sent: 5,
    failed: 1,
    other: 2,
  });
  assert.deepEqual(diagnostics.issues, []);
});

test("nothing arriving on WhatsApp is reported with the fixes that apply", () => {
  const diagnostics = whatsAppInboundDiagnostics(
    whatsAppInput({
      lastDirectMessageAt: null,
      directMessageCount: 0,
      autoReplyEventCounts: [],
      webhookSecretConfigured: false,
      webhookUrl: null,
      webhookUrlError: "WHATSAPP_WEBHOOK_URL_REQUIRED",
    }),
  );
  assert.equal(diagnostics.deliveryConfirmed, false);
  assert.equal(diagnostics.lastDirectMessageAt, null);
  assert.deepEqual(diagnostics.autoReplyEvents, {
    queued: 0,
    sent: 0,
    failed: 0,
    other: 0,
  });
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    [
      "WHATSAPP_WEBHOOK_SECRET_MISSING",
      "WHATSAPP_WEBHOOK_URL_REQUIRED",
      "WHATSAPP_NO_INBOUND_EVENTS",
    ],
  );
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.severity),
    ["critical", "critical", "warning"],
  );
  for (const issue of diagnostics.issues) {
    assert.match(issue.message, /[\u0600-\u06FF]/);
  }
});

test("a healthy Meta inbound path reports both platforms and no issues", () => {
  const diagnostics = metaInboundDiagnostics(metaInput());
  assert.equal(diagnostics.deliveryConfirmed, true);
  assert.deepEqual(diagnostics.inboxCountByPlatform, { facebook: 2, instagram: 1 });
  assert.deepEqual(diagnostics.autoReplyJobs, {
    queued: 1,
    completed: 2,
    failed: 1,
    skipped: 3,
  });
  assert.deepEqual(diagnostics.subscriptions.map((item) => item.platform), [
    "facebook",
    "instagram",
  ]);
  assert.equal(diagnostics.subscriptions[0].subscribedAt, "2026-11-24T02:20:00.000Z");
  assert.deepEqual(diagnostics.issues, []);
});

test("Meta configuration gaps and failed subscriptions are surfaced separately", () => {
  const diagnostics = metaInboundDiagnostics(
    metaInput({
      appSecretConfigured: false,
      verifyTokenConfigured: false,
      subscriptions: [
        {
          platform: "instagram",
          accountId: "17841415814930227",
          subscribedFields: [],
          subscribedAt: null,
          lastErrorCode: "token_expired",
        },
      ],
    }),
  );
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    [
      "META_APP_SECRET_MISSING",
      "META_WEBHOOK_VERIFY_TOKEN_MISSING",
      "META_SUBSCRIPTION_FAILED:token_expired",
    ],
  );
  assert.match(diagnostics.issues[2].message, /إنستغرام/);
});

test("enabled settings with no events arriving is called out explicitly", () => {
  const diagnostics = metaInboundDiagnostics(
    metaInput({ lastInboxItemAt: null, inboxItemCount: 0, inboxCountsByPlatform: [] }),
  );
  assert.equal(diagnostics.deliveryConfirmed, false);
  assert.deepEqual(diagnostics.inboxCountByPlatform, {});
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    ["META_NO_INBOUND_EVENTS"],
  );
  assert.match(diagnostics.issues[0].message, /Development/);
});

test("no recorded subscription at all is its own issue", () => {
  const diagnostics = metaInboundDiagnostics(metaInput({ subscriptions: [] }));
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    ["META_NO_SUBSCRIPTIONS"],
  );
  assert.deepEqual(diagnostics.subscriptions, []);
});
