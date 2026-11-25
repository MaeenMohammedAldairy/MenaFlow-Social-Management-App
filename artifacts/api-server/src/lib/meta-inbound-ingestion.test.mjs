import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  isMetaAutoReplyEligible,
  metaInboundNotifications,
  scheduleMetaAutoReplies,
} from "./meta-inbound-ingestion.ts";
import {
  classifyWhatsAppDirectMessage,
  selectWhatsAppDirectJid,
  whatsappDirectMessagePlaceholder,
} from "./whatsapp-direct-messages.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const settings = (overrides = {}) => ({
  enabled: true,
  facebookMessagesEnabled: true,
  facebookCommentsEnabled: true,
  instagramMessagesEnabled: true,
  instagramCommentsEnabled: true,
  ...overrides,
});

const item = (overrides = {}) => ({
  id: "item-1",
  workspaceId: "ws-a",
  platform: "facebook",
  kind: "message",
  conversationId: "person-1",
  actorId: "actor-1",
  actorName: "سارة",
  text: "هل المنتج متوفر؟",
  ...overrides,
});

function setup({
  configured = settings(),
  getSettingsError = null,
  insertError = null,
  insertedIds = null,
} = {}) {
  const jobs = [];
  const errors = [];
  const pipeline = (items) =>
    scheduleMetaAutoReplies({
      items,
      ownerId: "owner-a",
      workspaceId: "ws-a",
      nextRunAt: new Date("2026-11-25T12:00:00Z"),
      newJobId: () => `job-${jobs.length + 1}`,
      getSettings: async () => {
        if (getSettingsError) throw getSettingsError;
        return configured;
      },
      insertJobs: async (values) => {
        jobs.push(...values);
        if (insertError) throw insertError;
        return insertedIds ?? values.map((value) => value.inboxItemId);
      },
      onError: (error) => errors.push(error),
    });
  return { pipeline, jobs, errors };
}

test("a message is stored and announced when auto replies are disabled", async () => {
  const items = [item()];
  const { pipeline, jobs, errors } = setup({ configured: settings({ enabled: false }) });
  const result = await pipeline(items);

  assert.deepEqual(result, { reason: "disabled", queuedItemIds: [] });
  assert.deepEqual(jobs, [], "no reply job may be created while disabled");
  assert.deepEqual(errors, []);
  const alerts = metaInboundNotifications(items, result.queuedItemIds);
  assert.equal(alerts.length, 1, "the message must still be notified");
  assert.equal(alerts[0].awaitingReply, true);
});

test("an enabled auto reply queues a job and does not ask for a manual answer", async () => {
  const items = [item()];
  const { pipeline, jobs } = setup({ configured: settings() });
  const result = await pipeline(items);

  assert.equal(result.reason, "queued");
  assert.deepEqual(result.queuedItemIds, ["item-1"]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].inboxItemId, "item-1");
  assert.equal(jobs[0].workspaceId, "ws-a", "the job stays in the message's workspace");
  assert.equal(jobs[0].ownerId, "owner-a");
  assert.deepEqual(jobs[0].nextRunAt.toISOString(), "2026-11-25T12:00:00.000Z");
  assert.equal(metaInboundNotifications(items, result.queuedItemIds)[0].awaitingReply, false);
});

test("a failed job insert cannot erase the stored item or its notification", async () => {
  const items = [item(), item({ id: "item-2", platform: "instagram", kind: "comment" })];
  const boom = new Error("DATABASE_UNAVAILABLE");
  const { pipeline, errors } = setup({ insertError: boom });
  const result = await pipeline(items);

  assert.equal(result.reason, "queue_failed");
  assert.deepEqual(errors, [boom]);
  const alerts = metaInboundNotifications(items, result.queuedItemIds);
  assert.deepEqual(alerts.map((alert) => alert.item.id), ["item-1", "item-2"]);
  assert.deepEqual(alerts.map((alert) => alert.awaitingReply), [true, true]);
});

test("a failed settings lookup is contained and still leaves the inbox usable", async () => {
  const { pipeline, errors } = setup({ getSettingsError: new Error("SETTINGS_READ_FAILED") });
  const result = await pipeline([item()]);
  assert.equal(result.reason, "queue_failed");
  assert.equal(errors.length, 1);
});

test("Facebook and Instagram messages and comments each honour their own channel", () => {
  const channels = [
    ["facebook", "message", "facebookMessagesEnabled"],
    ["facebook", "comment", "facebookCommentsEnabled"],
    ["instagram", "message", "instagramMessagesEnabled"],
    ["instagram", "comment", "instagramCommentsEnabled"],
  ];
  for (const [platform, kind, key] of channels) {
    assert.equal(isMetaAutoReplyEligible(settings(), { platform, kind }), true);
    assert.equal(
      isMetaAutoReplyEligible(settings({ [key]: false, enabled: true }), { platform, kind }),
      false,
      `${key} must gate only its own channel`,
    );
  }
  const mixed = [item(), item({ id: "2", platform: "instagram", kind: "comment" })];
  const off = settings({ instagramCommentsEnabled: false });
  assert.deepEqual(mixed.filter((entry) => isMetaAutoReplyEligible(off, entry)).map((entry) => entry.id), ["item-1"]);
});

test("a channel-only disable does not suppress the other channel's queue", async () => {
  const items = [
    item(),
    item({ id: "item-2", platform: "instagram", kind: "comment" }),
  ];
  const { pipeline, jobs } = setup({ configured: settings({ instagramCommentsEnabled: false }) });
  const result = await pipeline(items);
  assert.equal(result.reason, "queued");
  assert.deepEqual(result.queuedItemIds, ["item-1"]);
  assert.deepEqual(jobs.map((job) => job.inboxItemId), ["item-1"]);
});

test("re-delivered webhook events do not double-queue a reply", async () => {
  const items = [item(), item({ id: "item-2" })];
  const { pipeline } = setup({ insertedIds: ["item-1"] });
  const result = await pipeline(items);
  assert.deepEqual(result.queuedItemIds, ["item-1"]);
  const alerts = metaInboundNotifications(items, result.queuedItemIds);
  assert.deepEqual(alerts.map((alert) => alert.awaitingReply), [false, true]);
});

test("the webhook transaction persists the inbox item only; automation runs outside it", () => {
  const source = readFileSync(path.join(HERE, "../routes/meta-webhook.ts"), "utf8");
  const txStart = source.indexOf("await db.transaction(");
  const txEnd = source.indexOf(");", source.indexOf(".returning({", txStart)) + 2;
  const transactionBody = source.slice(txStart, txEnd);
  assert.match(transactionBody, /insert\(menaMetaInboxItems\)/);
  assert.doesNotMatch(transactionBody, /menaMetaAutoReplyJobs/);
  assert.doesNotMatch(transactionBody, /notifyCustomerMessage|getSettings|menaMetaAutoReplySettings/);

  const after = source.slice(txEnd);
  assert.match(after, /scheduleMetaAutoReplies\(/);
  assert.match(after, /notifyCustomerMessage\(/);
  // The push alert is not driven by the auto-reply worker.
  assert.doesNotMatch(
    readFileSync(path.join(HERE, "meta-auto-reply-worker.ts"), "utf8"),
    /notifyCustomerMessage/,
  );
});

test("manual replies remain available regardless of the automatic-reply setting", () => {
  const replyRoute = readFileSync(
    path.join(HERE, "../routes/meta-inbox-replies.ts"),
    "utf8",
  );
  assert.doesNotMatch(replyRoute, /autoReplyEnabled|auto_reply_enabled/);
  const directReplyRoute = readFileSync(
    path.join(HERE, "../routes/whatsapp-direct-inbox.ts"),
    "utf8",
  );
  assert.doesNotMatch(directReplyRoute, /autoReplyEnabled|auto_reply_enabled/);
});

test("group messages keep their own Source route; DMs keep the inbox route", () => {
  const groupRoute = readFileSync(
    path.join(HERE, "../routes/whatsapp-messages.ts"),
    "utf8",
  );
  const directRoute = readFileSync(
    path.join(HERE, "../routes/whatsapp-direct-inbox.ts"),
    "utf8",
  );
  assert.match(groupRoute, /menaWhatsAppMessages/);
  assert.doesNotMatch(groupRoute, /menaWhatsAppDirectMessages/);
  assert.match(directRoute, /menaWhatsAppDirectMessages/);
  assert.doesNotMatch(directRoute, /menaWhatsAppMessages/);
  assert.match(
    readFileSync(path.join(HERE, "whatsapp-sync.ts"), "utf8"),
    /whatsappDirectMessagePlaceholder\(/,
  );
});

test("a WhatsApp group JID can never be selected as a direct inbox conversation", () => {
  assert.equal(selectWhatsAppDirectJid("120363000000000000@g.us"), null);
  assert.equal(selectWhatsAppDirectJid(null, "120363000000000000@g.us"), null);
  assert.equal(
    selectWhatsAppDirectJid("967712345678@s.whatsapp.net", "120363000000000000@g.us"),
    "967712345678@s.whatsapp.net",
  );
});

test("media-only WhatsApp DMs get a typed placeholder without leaving the inbox empty", () => {
  const image = { imageMessage: { caption: null } };
  const audio = { message: { audioMessage: {} } };
  const document = { documentMessage: {} };
  assert.equal(classifyWhatsAppDirectMessage(image, null), "image");
  assert.equal(classifyWhatsAppDirectMessage(audio, null), "audio");
  assert.equal(classifyWhatsAppDirectMessage(document, null), "document");
  for (const message of [image, audio, document]) {
    const placeholder = whatsappDirectMessagePlaceholder(
      classifyWhatsAppDirectMessage(message, null),
    );
    assert.match(placeholder, /[\u0600-\u06FF]/);
    assert.doesNotMatch(placeholder, /https?:|storage|@s\.whatsapp\.net/);
  }
});
