import assert from "node:assert/strict";
import test from "node:test";
import { groupWhatsAppMessages } from "./source-message-groups.ts";

function message(overrides = {}) {
  return {
    id: "message-1",
    mediaGroupId: null,
    mediaGroupSource: null,
    contentBundleId: null,
    mediaGroupIndex: null,
    mediaGroupExpectedCount: null,
    media: [],
    textBody: null,
    caption: null,
    mediaAvailable: false,
    mediaDownloadStatus: "not_required",
    linkedPostId: null,
    linkedPostStatus: null,
    senderName: null,
    senderId: null,
    messageTimestamp: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("groups related WhatsApp messages and deduplicates their text", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "first",
      mediaGroupId: "album-1",
      mediaGroupSource: "protocol_association",
      textBody: "  Offer  ",
      senderName: "Store",
      messageTimestamp: "2026-01-02T00:00:00.000Z",
    }),
    message({
      id: "second",
      mediaGroupId: "album-1",
      mediaGroupSource: "protocol_association",
      caption: "Offer",
      mediaGroupExpectedCount: 2,
      messageTimestamp: "2026-01-01T00:00:00.000Z",
      linkedPostId: "post-1",
      linkedPostStatus: "review",
      media: [
        { mediaIndex: 1, downloadStatus: "stored" },
        { mediaIndex: 0, downloadStatus: "stored" },
      ],
    }),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].key, "album-1");
  assert.equal(grouped[0].text, "Offer");
  assert.equal(grouped[0].expectedCount, 2);
  assert.equal(grouped[0].postId, "post-1");
  assert.equal(grouped[0].postStatus, "review");
  assert.equal(grouped[0].messageTimestamp, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(
    grouped[0].media.map(({ item }) => item.mediaIndex),
    [0, 1],
  );
});

test("keeps legacy and unconfirmed media groups separate until explicit confirmation", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "legacy-a",
      mediaGroupId: "old-inferred-id",
      mediaAvailable: true,
    }),
    message({
      id: "legacy-b",
      mediaGroupId: "old-inferred-id",
      mediaAvailable: true,
    }),
    message({
      id: "text-a",
      contentBundleId: "confirmed-content",
      textBody: "منتج",
    }),
    message({
      id: "image-a",
      contentBundleId: "confirmed-content",
      mediaAvailable: true,
    }),
  ]);

  assert.equal(grouped.length, 3);
  assert.deepEqual(
    grouped.map((item) => item.messages.map(({ id }) => id)),
    [["legacy-a"], ["legacy-b"], ["text-a", "image-a"]],
  );
  assert.equal(grouped[2].contentBundleId, "confirmed-content");
});

test("keeps standalone messages separate and reports pending/failed media", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "pending",
      mediaAvailable: true,
      mediaDownloadStatus: "pending",
    }),
    message({
      id: "failed",
      mediaAvailable: true,
      mediaDownloadStatus: "failed",
      media: [{ mediaIndex: 0, downloadStatus: "failed" }],
    }),
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].mediaPending, true);
  assert.equal(grouped[0].mediaFailed, false);
  assert.equal(grouped[1].mediaPending, false);
  assert.equal(grouped[1].mediaFailed, true);
});

test("keeps standalone text separate from a nearby album until a user confirms the bundle", () => {
  const album = message({
    id: "album",
    mediaGroupId: "confirmed-album",
    mediaGroupSource: "protocol_association",
    mediaAvailable: true,
    media: [{ id: "album-image", mediaType: "image", downloadStatus: "stored" }],
  });
  const textBefore = message({
    id: "text-before",
    textBody: "منتج مستقل",
  });
  const textAfter = message({
    id: "text-after",
    textBody: "منتج مستقل",
  });

  assert.deepEqual(
    groupWhatsAppMessages([textBefore, album, textAfter])
      .map((group) => group.messages.map((item) => item.id)),
    [["text-before"], ["album"], ["text-after"]],
  );

  assert.deepEqual(
    groupWhatsAppMessages([
      { ...textBefore, contentBundleId: "user-confirmed-bundle" },
      { ...album, contentBundleId: "user-confirmed-bundle" },
      textAfter,
    ]).map((group) => group.messages.map((item) => item.id)),
    [["text-before", "album"], ["text-after"]],
  );
});

test("keeps an image caption with its message and separate from another explicit album", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "captioned-image",
      caption: "صورة المنتج الأول",
      mediaAvailable: true,
      media: [{ id: "image-one", mediaType: "image", downloadStatus: "stored" }],
    }),
    message({
      id: "different-album",
      mediaGroupId: "album-two",
      mediaGroupSource: "provider_album_container",
      mediaAvailable: true,
      media: [{ id: "image-two", mediaType: "image", downloadStatus: "stored" }],
    }),
  ]);

  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].text, "صورة المنتج الأول");
  assert.equal(grouped[0].mediaGroupId, null);
});

test("returns an empty list when there are no messages", () => {
  assert.deepEqual(groupWhatsAppMessages([]), []);
});
