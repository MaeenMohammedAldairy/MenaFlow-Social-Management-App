/**
 * Shadow bundle engine — Phase 2 tests.
 *
 * Every case below is taken from rows that actually exist in production (the
 * remote message ids are real). The test file asserts the *design promises*:
 * products are never mixed, text is never lost, time alone never merges, and an
 * ordinary message is not turned into an extraction candidate.
 *
 * Nothing here touches Postgres, Gemini, the Legacy workers, or the webhook.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  checkMergeGuard,
  distinctiveProductTokens,
  planShadowBundles,
} from "./whatsapp-bundle-engine.ts";
import { compareShadowPlan } from "./whatsapp-bundle-shadow-compare.ts";

const WORKSPACE = "ws";
const OWNER = "owner";
const INSTANCE = "mena";
const GROUP_ID = "3c26d6f4-80c1-411c-942b-e45385589fd9";
const GROUP_JID = "120363430177130458@g.us";
const SENDER = "+967777187184";
const NOW = new Date("2026-11-28T18:30:00.000Z");

let counter = 0;

function message(overrides = {}) {
  counter += 1;
  const id = overrides.id ?? `m-${counter}`;
  const withMedia = overrides.media ?? false;
  return {
    id,
    remoteMessageId: overrides.remoteMessageId ?? id,
    workspaceId: WORKSPACE,
    ownerId: OWNER,
    instanceName: INSTANCE,
    groupId: GROUP_ID,
    groupJid: GROUP_JID,
    senderId: overrides.senderId ?? SENDER,
    messageType: overrides.messageType ?? (withMedia ? "imageMessage" : "conversation"),
    textBody: overrides.text ?? null,
    caption: overrides.caption ?? null,
    mediaAvailable: withMedia,
    mediaGroupId: overrides.mediaGroupId ?? null,
    mediaGroupSource: overrides.mediaGroupId ? (overrides.mediaGroupSource ?? "protocol_association") : null,
    mediaGroupExpectedCount: overrides.expected ?? null,
    mediaGroupIndex: null,
    replyToRemoteId: overrides.replyTo ?? null,
    messageTimestamp: overrides.at,
    createdAt: overrides.createdAt ?? overrides.at,
    media: withMedia
      ? [{ id: `md-${id}`, downloadStatus: overrides.downloadStatus ?? "stored" }]
      : [],
  };
}

/** Production timestamps, verbatim. */
const at = (day, time) => `${day}T${time}Z`;

function plan(messages, options = {}) {
  return planShadowBundles(messages, { evaluatedAt: NOW, ...options });
}

function bundleOf(result, messageId) {
  const bundleId = result.messageBundle.get(messageId);
  return result.bundles.find((bundle) => bundle.id === bundleId) ?? null;
}

function membersOf(result, messageId) {
  const bundle = bundleOf(result, messageId);
  return bundle ? bundle.members.map((member) => member.messageId).sort() : [];
}

const GUN_ALBUM = "album:5e793280bf47f71a5a8c1fc809ddaad781fd53a6ef0764afa7e35827dd4b489c";

function massageGun() {
  return [
    message({
      id: "ac72828e-gun-text",
      remoteMessageId: "AC72828E726D35275A84F765D52A7326",
      text: "السعر بعد التخفيض 9500 ريااال\n\nمسدس تدليك العضلات الاحترافي مزود بـ12 راس",
      at: at("2026-11-26", "20:51:10.000"),
    }),
    message({
      id: "acfeface-gun-album",
      remoteMessageId: "ACFEFACE",
      messageType: "albumMessage",
      mediaGroupId: GUN_ALBUM,
      expected: 13,
      at: at("2026-11-26", "20:51:10.000"),
    }),
    ...Array.from({ length: 12 }, (_, index) =>
      message({
        id: `gun-image-${index + 1}`,
        media: true,
        mediaGroupId: GUN_ALBUM,
        at: at("2026-11-26", `20:51:${String(10 + Math.floor(index / 4)).padStart(2, "0")}.000`),
      }),
    ),
  ];
}

function drainPowder() {
  // NAVIFORCE text first, then three photos with no album, then the Drain text.
  return [
    message({
      id: "ac395ebe-naviforce",
      remoteMessageId: "AC395EBE954CA284FC2B811ACE0802D9",
      text: "عروض شهر 11 ساعات نافي فورس حديد رجالي",
      at: at("2026-11-24", "22:02:41.000"),
    }),
    message({ id: "ac0232be-drain-1", media: true, at: at("2026-11-24", "22:09:11.000") }),
    message({ id: "ac18d922-drain-2", media: true, at: at("2026-11-24", "22:09:11.000") }),
    message({ id: "ac86c24c-drain-3", media: true, at: at("2026-11-24", "22:09:12.000") }),
    message({
      id: "acb1dd62-drain-text",
      remoteMessageId: "ACB1DD625F130C7C7E810200DAC9BBAA",
      text: "مسحوق سحري لفك انسداد الأنابيب\n\nفقط ب 1000ريال",
      at: at("2026-11-24", "22:09:22.000"),
    }),
  ];
}

// ---------------------------------------------------------------- case 1 ----

test("case 1 — Massage Gun: the price text and its 12 photos land in one bundle", () => {
  const result = plan(massageGun());
  const bundle = bundleOf(result, "ac72828e-gun-text");

  assert.ok(bundle, "the price text must belong to a bundle");
  assert.equal(bundle.status, "READY");
  assert.equal(bundle.kind, "album");
  // The regression the legacy pipeline has today: the album keeps the photos and
  // the price text is dropped. Both halves must be here.
  assert.ok(membersOf(result, "ac72828e-gun-text").includes("gun-image-12"));
  assert.ok(membersOf(result, "gun-image-12").includes("ac72828e-gun-text"));
  assert.equal(membersOf(result, "gun-image-12").length, 14);
  assert.equal(bundle.mediaExpected, 12, "13 advertised minus the container itself");
  assert.equal(bundle.mediaStored, 12);
});

// ------------------------------------------------------------ cases 2+3 ----

test("case 2 — Drain Powder: three album-less photos group without absorbing another product", () => {
  const result = plan(drainPowder());
  const bundle = bundleOf(result, "acb1dd62-drain-text");

  assert.ok(bundle);
  assert.equal(bundle.members.length, 4, "three photos + the drain text");
  assert.ok(membersOf(result, "ac0232be-drain-1").includes("ac86c24c-drain-3"));
});

test("case 3 — NAVIFORCE never ends up inside the Drain Powder bundle", () => {
  const result = plan(drainPowder());
  const bundle = bundleOf(result, "acb1dd62-drain-text");
  const members = bundle.members.map((member) => member.messageId);

  assert.ok(!members.includes("ac395ebe-naviforce"));
  assert.notEqual(bundleOf(result, "ac395ebe-naviforce").id, bundle.id);
});

// ---------------------------------------------------------------- case 4 ----

test("case 4 — image first, text after: the pair still becomes one bundle", () => {
  const result = plan([
    message({ id: "photo", media: true, at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "10:00:12.000") }),
  ]);

  assert.deepEqual(membersOf(result, "photo"), ["photo", "text"]);
  assert.equal(bundleOf(result, "photo").status, "READY");
});

// ---------------------------------------------------------------- case 5 ----

test("case 5 — text first, image after: symmetric to case 4", () => {
  const result = plan([
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "photo", media: true, at: at("2026-11-28", "10:00:12.000") }),
  ]);

  assert.deepEqual(membersOf(result, "text"), ["photo", "text"]);
  assert.equal(bundleOf(result, "text").status, "READY");
});

// ---------------------------------------------------------------- case 6 ----

test("case 6 — photo, photo, photo, then text: all four in one bundle", () => {
  const result = plan([
    message({ id: "p1", media: true, at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "p2", media: true, at: at("2026-11-28", "10:00:04.000") }),
    message({ id: "p3", media: true, at: at("2026-11-28", "10:00:08.000") }),
    message({ id: "text", text: "مسحوق سحري 270 جرام 1000 ريال", at: at("2026-11-28", "10:00:30.000") }),
  ]);

  assert.deepEqual(membersOf(result, "p1"), ["p1", "p2", "p3", "text"]);
});

// ---------------------------------------------------------------- case 7 ----

test("case 7 — product A then product B are not merged by proximity in time", () => {
  const result = plan([
    message({ id: "a-text", text: "ساعة نافي فورس حديد رجالي 6500", at: at("2026-11-28", "09:00:00.000") }),
    message({ id: "a-photo", media: true, at: at("2026-11-28", "09:00:05.000") }),
    message({ id: "b-text", text: "مسحوق سحري لانسداد الانابيب 1000", at: at("2026-11-28", "09:02:00.000") }),
    message({ id: "b-photo", media: true, at: at("2026-11-28", "09:02:05.000") }),
  ]);

  assert.deepEqual(membersOf(result, "a-photo"), ["a-photo", "a-text"]);
  assert.deepEqual(membersOf(result, "b-photo"), ["b-photo", "b-text"]);
});

test("case 7b — two products, no photos: two singletons, never one bundle", () => {
  const result = plan([
    message({ id: "a-text", text: "ساعة نافي فورس حديد رجالي 6500", at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "b-text", text: "مسحوق سحري لانسداد الانابيب 1000", at: at("2026-11-28", "10:00:08.000") }),
  ]);

  assert.equal(result.bundles.length, 2);
  for (const bundle of result.bundles) assert.equal(bundle.members.length, 1);
});

// ---------------------------------------------------------------- case 8 ----

test("case 8 — an ordinary greeting is a singleton, not an extraction candidate", () => {
  const result = plan([message({ id: "hello", text: "السلام عليكم", at: at("2026-11-28", "10:00:00.000") })]);
  const bundle = bundleOf(result, "hello");

  assert.equal(bundle.members.length, 1);
  assert.equal(bundle.kind, "single");
  assert.equal(bundle.evidence, "NONE");
  assert.equal(bundle.status, "READY");
});

// ------------------------------------------------------------ the guard ----

test("guard — conflicting product tokens refuse the merge", () => {
  assert.equal(
    checkMergeGuard({
      left: { hasStrongEvidence: false, tokens: distinctiveProductTokens("ساعة نافي فورس حديد رجالي"), albumId: null },
      right: { hasStrongEvidence: false, tokens: distinctiveProductTokens("مسحوق سحري لفك انسداد الأنابيب"), albumId: null },
    }),
    "PRODUCT_TOKEN_CONFLICT",
  );
});

test("guard — different albums refuse the merge", () => {
  assert.equal(
    checkMergeGuard({
      left: { hasStrongEvidence: true, tokens: new Set(["دفاية"]), albumId: "album:a" },
      right: { hasStrongEvidence: true, tokens: new Set(["دفاية"]), albumId: "album:b" },
    }),
    "DIFFERENT_ALBUMS",
  );
});

test("guard — an already-claimed free text cannot be re-claimed", () => {
  const result = plan([
    message({ id: "photo", media: true, at: at("2026-11-28", "09:00:00.000") }),
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "09:00:10.000") }),
    message({ id: "photo-2", media: true, at: at("2026-11-28", "09:05:00.000") }),
  ]);

  // The near text wins; the distant photo waits for its own text instead of
  // stealing the sentence that is already spoken for.
  assert.deepEqual(membersOf(result, "text"), ["photo", "text"]);
  assert.equal(bundleOf(result, "photo-2").members.length, 1);
  assert.equal(bundleOf(result, "photo-2").status, "COLLECTING");
});

test("guard — a captioned photo is not stolen as another cluster's anchor", () => {
  const result = plan([
    message({ id: "captioned", media: true, caption: "وصل وصل", at: at("2026-11-28", "17:44:51.000") }),
    message({ id: "photo", media: true, at: at("2026-11-28", "17:44:51.000") }),
    message({ id: "text", text: "مسدس تسليك المجاري 8500 ريال", at: at("2026-11-28", "17:44:51.000") }),
  ]);

  // `captioned` brings its own words, so it stays a bundle of one and the plain
  // text is free to pair with the plain photo.
  assert.deepEqual(membersOf(result, "captioned"), ["captioned"]);
  assert.deepEqual(membersOf(result, "photo"), ["photo", "text"]);
});

// ------------------------------------------------------------ readiness ----

test("readiness — an album that never received its children settles as MEDIA_PARTIAL", () => {
  const result = plan([
    message({
      id: "ac5ccde-naviforce-album",
      remoteMessageId: "ACE5CCDE",
      messageType: "albumMessage",
      mediaGroupId: "album:64ed7a888acd",
      mediaGroupSource: "provider_album_container",
      expected: 2,
      at: at("2026-11-24", "22:02:41.000"),
    }),
    message({ id: "naviforce", text: "ساعات نافي فورس حديد رجالي 6500", at: at("2026-11-24", "22:02:41.000") }),
  ]);

  const bundle = bundleOf(result, "ac5ccde-naviforce-album");
  assert.equal(bundle.status, "READY", "2 expected, 0 stored must not wait forever");
  assert.equal(bundle.reviewReason, "MEDIA_PARTIAL");
  assert.equal(bundle.mediaExpected, 2);
  assert.equal(bundle.mediaStored, 0);
});

test("readiness — pending media keeps the bundle COLLECTING", () => {
  const result = plan([
    message({ id: "photo", media: true, downloadStatus: "pending", at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "text", text: "مسحوق سحري 1000 ريال", at: at("2026-11-28", "10:00:20.000") }),
  ]);

  const bundle = bundleOf(result, "photo");
  assert.equal(bundle.status, "COLLECTING");
  assert.equal(bundle.reviewReason, "MEDIA_PENDING");
  // The text is already captured: a late image addition cannot lose it.
  assert.ok(bundle.members.some((member) => member.messageId === "text"));
});

test("readiness — a fresh photo with no text waits instead of being queued alone", () => {
  const result = plan([
    message({ id: "photo", media: true, at: at("2026-11-28", "18:29:30.000") }),
  ]);

  const bundle = bundleOf(result, "photo");
  assert.equal(bundle.status, "COLLECTING");
  assert.equal(bundle.reviewReason, "NEEDS_TEXT");
});

test("readiness — an ambiguous album with two candidate texts goes to NEEDS_REVIEW, not to a guess", () => {
  const result = plan([
    message({
      id: "album-container",
      messageType: "albumMessage",
      mediaGroupId: "album:2157410a77",
      expected: 3,
      at: at("2026-11-28", "17:44:50.000"),
    }),
    message({ id: "album-1", media: true, mediaGroupId: "album:2157410a77", at: at("2026-11-28", "17:44:52.000") }),
    message({ id: "album-2", media: true, mediaGroupId: "album:2157410a77", at: at("2026-11-28", "17:44:52.000") }),
    message({ id: "album-3", media: true, mediaGroupId: "album:2157410a77", at: at("2026-11-28", "17:44:52.000") }),
    message({ id: "vacuum", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "17:44:50.000") }),
    message({ id: "clock", text: "ساعة الحائط الزاوية الثنائية", at: at("2026-11-28", "17:44:52.000") }),
  ]);

  const bundle = bundleOf(result, "album-1");
  assert.equal(bundle.status, "NEEDS_REVIEW");
  assert.equal(bundle.reviewReason, "MULTIPLE_TEXT_CANDIDATES");
  // Neither candidate text is swallowed by the waiting cluster.
  assert.ok(!bundle.members.some((member) => member.messageId === "vacuum"));
  assert.ok(!bundle.members.some((member) => member.messageId === "clock"));
});

// ------------------------------------------------------------- the race ----

test("race — legacy can lose the text; the shadow engine keeps it", () => {
  // The exact production shape: photo arrives and a job is created while its
  // media is still downloading; the text arrives 20 s later; the legacy worker
  // has already read the message set and never re-reads it.
  const messages = [
    message({ id: "photo", media: true, downloadStatus: "pending", at: at("2026-11-28", "10:00:00.000") }),
  ];
  const beforeText = plan(messages);
  assert.equal(bundleOf(beforeText, "photo").status, "COLLECTING");

  const afterText = plan([
    ...messages,
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "10:00:20.000") }),
  ]);
  const bundle = bundleOf(afterText, "photo");
  assert.ok(bundle.members.some((member) => member.messageId === "text"));

  // And the legacy comparison labels it WAITING_MEDIA rather than a silent match.
  const legacy = new Map([
    ["photo", { groupKey: "message:photo", kind: "message", memberMessageIds: ["photo"], reason: null }],
    ["text", { groupKey: null, kind: "none", memberMessageIds: ["text"], reason: "MISSING_SIGNAL" }],
  ]);
  const comparison = compareShadowPlan({ plan: afterText, legacyByMessage: legacy });
  const textRow = comparison.messages.find((row) => row.messageId === "text");
  assert.equal(textRow.result, "MISSING_SIGNAL");
});

// ------------------------------------------------------- shadow compare ----

test("compare — identical membership with different ids is a MATCH", () => {
  const result = plan([
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "photo", media: true, at: at("2026-11-28", "10:00:05.000") }),
  ]);
  const legacy = new Map([
    ["text", { groupKey: "bundle:abc", kind: "bundle", memberMessageIds: ["photo", "text"], reason: null }],
    ["photo", { groupKey: "bundle:abc", kind: "bundle", memberMessageIds: ["photo", "text"], reason: null }],
  ]);
  const comparison = compareShadowPlan({ plan: result, legacyByMessage: legacy });

  assert.equal(comparison.byResult.MATCH, 2);
});

test("compare — a wider legacy group is LEGACY_MERGE", () => {
  const result = plan(drainPowder());
  const legacy = new Map([
    [
      "ac0232be-drain-1",
      {
        groupKey: "bundle:81131ea5",
        kind: "bundle",
        memberMessageIds: [
          "ac395ebe-naviforce",
          "ac0232be-drain-1",
          "ac18d922-drain-2",
          "ac86c24c-drain-3",
          "acb1dd62-drain-text",
        ],
        reason: null,
      },
    ],
  ]);
  const comparison = compareShadowPlan({ plan: result, legacyByMessage: legacy });
  assert.ok(comparison.byResult.LEGACY_MERGE >= 1);
});

test("compare — legacy queued one message alone is LEGACY_SPLIT", () => {
  const result = plan(drainPowder());
  const legacy = new Map([
    ["acb1dd62-drain-text", { groupKey: "message:acb1dd62", kind: "message", memberMessageIds: ["acb1dd62-drain-text"], reason: null }],
  ]);
  const comparison = compareShadowPlan({ plan: result, legacyByMessage: legacy });
  const row = comparison.messages.find((item) => item.messageId === "acb1dd62-drain-text");

  assert.equal(row.result, "LEGACY_SPLIT");
  assert.equal(row.reason, "LEGACY_QUEUED_ONE_MESSAGE_ALONE");
});

test("compare — crossing memberships are SET_OVERLAP, not a width difference", () => {
  const result = plan([
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "photo", media: true, at: at("2026-11-28", "10:00:05.000") }),
    message({ id: "other", text: "ساعة الحائط الزاوية الثنائية", at: at("2026-11-28", "11:00:00.000") }),
  ]);
  const legacy = new Map([
    ["text", { groupKey: "bundle:1", kind: "bundle", memberMessageIds: ["text", "other"], reason: null }],
    ["photo", { groupKey: "bundle:1", kind: "bundle", memberMessageIds: ["text", "other"], reason: null }],
  ]);
  const comparison = compareShadowPlan({ plan: result, legacyByMessage: legacy });
  assert.ok(comparison.byResult.SET_OVERLAP >= 1);
  const row = comparison.messages.find((item) => item.messageId === "photo");
  assert.equal(row.reason, "MEMBERSHIPS_CROSS");
});

test("compare — the engine never returns a bundle that straddles two albums", () => {
  const result = plan([
    message({ id: "a1", media: true, mediaGroupId: "album:a", at: at("2026-11-28", "09:00:00.000") }),
    message({ id: "a2", media: true, mediaGroupId: "album:a", at: at("2026-11-28", "09:00:01.000") }),
    message({ id: "text", text: "دفاية الجدار الذكية", at: at("2026-11-28", "09:00:10.000") }),
    message({ id: "b1", media: true, mediaGroupId: "album:b", at: at("2026-11-28", "09:00:20.000") }),
    message({ id: "b2", media: true, mediaGroupId: "album:b", at: at("2026-11-28", "09:00:21.000") }),
  ]);

  const albumA = bundleOf(result, "a1");
  const albumB = bundleOf(result, "b1");
  assert.notEqual(albumA.id, albumB.id);
  assert.ok(!albumA.members.some((member) => member.messageId === "b1"));
});

test("plan — is deterministic and keeps bundle ids stable when the window grows", () => {
  const base = [
    message({ id: "text", text: "مكنسة غسيل السجاد 1200 واط", at: at("2026-11-28", "10:00:00.000") }),
    message({ id: "photo", media: true, at: at("2026-11-28", "10:00:05.000") }),
  ];
  const first = plan(base);
  const second = plan([
    ...base,
    message({ id: "late", media: true, at: at("2026-11-28", "10:00:09.000") }),
  ]);

  assert.equal(bundleOf(first, "text").id, bundleOf(second, "text").id);
  assert.equal(second.messageBundle.get("late"), bundleOf(first, "text").id);
});
