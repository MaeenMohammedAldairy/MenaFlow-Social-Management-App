import assert from "node:assert/strict";
import test from "node:test";
import {
  metaInboundDiagnostics,
  postponedRepliesSentence,
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
    postponedByLimit: 0,
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
    postponedByLimit: 0,
  });
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    [
      "WHATSAPP_WEBHOOK_SECRET_MISSING",
      "WHATSAPP_WEBHOOK_URL_REQUIRED",
      "WHATSAPP_NO_WEBHOOK_ATTEMPTS",
    ],
  );
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.severity),
    ["critical", "critical", "critical"],
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
    postponedByLimit: 0,
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
    ["META_NO_WEBHOOK_ATTEMPTS"],
  );
  assert.equal(diagnostics.issues[0].severity, "critical");
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

test("recorded attempts split 'never called' from 'called and refused'", () => {
  const diagnostics = whatsAppInboundDiagnostics(
    whatsAppInput({
      lastDirectMessageAt: null,
      directMessageCount: 0,
      autoReplyEventCounts: [],
      webhookAttempts: [
        {
          event: "WHATSAPP_WEBHOOK_PROCESSED",
          deliveryConfirmed: true,
          createdAt: new Date("2026-11-24T03:40:00.000Z"),
        },
        {
          event: "WHATSAPP_WEBHOOK_IGNORED_EVENT",
          deliveryConfirmed: true,
          createdAt: new Date("2026-11-24T03:45:00.000Z"),
        },
      ],
    }),
  );
  // Delivery happened and nothing was refused, so the cause is upstream: the
  // events that do arrive are not direct messages.
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    ["WHATSAPP_NO_INBOUND_EVENTS"],
  );
  assert.equal(diagnostics.webhookAttempts.count, 2);
  assert.equal(diagnostics.webhookAttempts.rejectedCount, 0);
  assert.equal(diagnostics.webhookAttempts.acceptedCount, 2);
  assert.equal(
    diagnostics.webhookAttempts.lastEvent,
    "WHATSAPP_WEBHOOK_IGNORED_EVENT",
  );
  assert.equal(
    diagnostics.webhookAttempts.lastAt,
    "2026-11-24T03:45:00.000Z",
  );
  assert.match(diagnostics.webhookAttempts.lastHint, /[\u0600-\u06FF]/);
});

test("every attempt refused names the recorded outcome", () => {
  const diagnostics = whatsAppInboundDiagnostics(
    whatsAppInput({
      lastDirectMessageAt: null,
      directMessageCount: 0,
      autoReplyEventCounts: [],
      webhookAttempts: [
        {
          event: "WHATSAPP_WEBHOOK_REJECTED_SECRET",
          deliveryConfirmed: true,
          createdAt: "2026-11-24T03:50:00.000Z",
        },
      ],
    }),
  );
  assert.deepEqual(
    diagnostics.issues.map((issue) => issue.code),
    ["WHATSAPP_WEBHOOK_ATTEMPTS_REJECTED"],
  );
  assert.equal(diagnostics.issues[0].severity, "critical");
  assert.match(
    diagnostics.issues[0].message,
    /WHATSAPP_WEBHOOK_REJECTED_SECRET/,
  );
  assert.equal(diagnostics.webhookAttempts.rejectedCount, 1);
  assert.equal(diagnostics.webhookAttempts.acceptedCount, 0);
  assert.match(diagnostics.webhookAttempts.lastRejectedHint, /[\u0600-\u06FF]/);
});

test("attempts arriving while messages do flow are reported without an issue", () => {
  const diagnostics = metaInboundDiagnostics(
    metaInput({
      webhookAttempts: [
        {
          event: "META_WEBHOOK_AUTO_REPLY_QUEUED",
          deliveryConfirmed: true,
          createdAt: new Date("2026-11-24T02:53:20.000Z"),
        },
      ],
    }),
  );
  assert.deepEqual(diagnostics.issues, []);
  assert.equal(diagnostics.webhookAttempts.count, 1);
  assert.equal(diagnostics.webhookAttempts.acceptedCount, 1);
});

test("Meta attempts distinguish a never-called provider from refused calls", () => {
  const neverCalled = metaInboundDiagnostics(
    metaInput({
      lastInboxItemAt: null,
      inboxItemCount: 0,
      inboxCountsByPlatform: [],
      webhookAttempts: [],
    }),
  );
  assert.deepEqual(
    neverCalled.issues.map((issue) => issue.code),
    ["META_NO_WEBHOOK_ATTEMPTS"],
  );
  assert.equal(neverCalled.webhookAttempts.count, 0);
  assert.equal(neverCalled.webhookAttempts.lastAt, null);

  const refused = metaInboundDiagnostics(
    metaInput({
      lastInboxItemAt: null,
      inboxItemCount: 0,
      inboxCountsByPlatform: [],
      webhookAttempts: [
        {
          event: "META_WEBHOOK_REJECTED_SIGNATURE",
          deliveryConfirmed: true,
          createdAt: new Date("2026-11-24T02:00:00.000Z"),
        },
        {
          event: "META_WEBHOOK_PROCESSED",
          deliveryConfirmed: true,
          createdAt: new Date("2026-11-23T22:00:00.000Z"),
        },
      ],
    }),
  );
  // One accepted attempt means Meta does reach us, so the cause is attribution.
  assert.deepEqual(
    refused.issues.map((issue) => issue.code),
    ["META_NO_INBOUND_EVENTS"],
  );
  assert.equal(refused.webhookAttempts.rejectedCount, 1);
  assert.equal(refused.webhookAttempts.acceptedCount, 1);
});

test("attempts are not summarized when the log was not read", () => {
  const diagnostics = whatsAppInboundDiagnostics(whatsAppInput({}));
  assert.equal(diagnostics.webhookAttempts, null);
});

test("replies waiting on a limit are counted and explained", () => {
  const diagnostics = whatsAppInboundDiagnostics(
    whatsAppInput({
      queuedReplyErrorCodes: [
        "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
        null,
        "MISSING_AI_PROVIDER_KEY",
        "EVOLUTION_API_UNREACHABLE",
      ],
    }),
  );
  // Two of the four are limits that lift by themselves; a transient provider
  // fault and a null code are just work in progress.
  assert.equal(diagnostics.autoReplyEvents.postponedByLimit, 2);
  const issue = diagnostics.issues.find(
    (candidate) => candidate.code === "WHATSAPP_AUTO_REPLIES_POSTPONED_FOR_LIMIT",
  );
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.match(issue.message, /ردّان مؤجَّلان/);
  assert.match(issue.message, /تلقائيًا/);
  assert.match(issue.message, /يدويًا/);
});

test("no postponed replies means no postponed issue and a zero count", () => {
  const diagnostics = whatsAppInboundDiagnostics(whatsAppInput({}));
  assert.equal(diagnostics.autoReplyEvents.postponedByLimit, 0);
  assert.deepEqual(diagnostics.issues, []);

  const meta = metaInboundDiagnostics(metaInput({}));
  assert.equal(meta.autoReplyJobs.postponedByLimit, 0);
  assert.deepEqual(meta.issues, []);
});

test("Meta jobs postponed by a limit are reported the same way", () => {
  const diagnostics = metaInboundDiagnostics(
    metaInput({
      queuedJobErrorCodes: [
        "SUBSCRIPTION_LIMIT_REACHED:aiGenerations",
        "WORKSPACE_SUBSCRIPTION_MISSING",
        // A class name is not a code: the Meta queue always stored the error's
        // message, so a row like this cannot be waiting on a limit.
        "SubscriptionAiQuotaError",
        null,
      ],
    }),
  );
  assert.equal(diagnostics.autoReplyJobs.postponedByLimit, 2);
  const issue = diagnostics.issues.find(
    (candidate) => candidate.code === "META_AUTO_REPLIES_POSTPONED_FOR_LIMIT",
  );
  assert.ok(issue);
  assert.match(issue.message, /ردّان مؤجَّلان/);
});

test("the postponed sentence agrees with the count it states", () => {
  // Arabic numeral agreement: one, two, three to ten, eleven and above.
  assert.match(postponedRepliesSentence(1), /^ردّ واحد مؤجَّل/);
  assert.match(postponedRepliesSentence(2), /^ردّان مؤجَّلان/);
  assert.match(postponedRepliesSentence(3), /^٣ ردود مؤجَّلة/);
  assert.match(postponedRepliesSentence(10), /^١٠ ردود مؤجَّلة/);
  assert.match(postponedRepliesSentence(11), /^١١ ردًّا مؤجَّلًا/);
  assert.match(postponedRepliesSentence(250), /^٢٥٠ ردًّا مؤجَّلًا/);
  // A count that cannot happen must not produce a broken sentence.
  assert.match(postponedRepliesSentence(0), /^٠ ردود مؤجَّلة/);
  assert.match(postponedRepliesSentence(Number.NaN), /^٠ ردود مؤجَّلة/);
  for (const count of [0, 1, 2, 7, 40]) {
    const sentence = postponedRepliesSentence(count);
    assert.match(sentence, /حصة الذكاء الاصطناعي/);
    assert.match(sentence, /تلقائيًا/);
    assert.match(sentence, /يدويًا/);
    assert.doesNotMatch(sentence, /[0-9]/, "latin digits leaked");
  }
});
