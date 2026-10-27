import assert from "node:assert/strict";
import test from "node:test";
import {
  canConvertWhatsAppMessageGroup,
  groupWhatsAppMessages,
} from "./source-message-groups.ts";

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

test("adds candidate album media to suggestions without merging the groups", () => {
  const requester = message({
    id: "requester",
    associationSuggestions: [{
      sourceMessageId: "requester",
      candidateGroupKey: "album:candidate-album",
      candidateMessageId: "candidate-image",
      candidateText: null,
      candidateMediaCount: 2,
    }],
  });
  const candidateAlbumFirst = message({
    id: "candidate-image",
    mediaGroupId: "candidate-album",
    mediaGroupSource: "protocol_association",
    media: [{ id: "candidate-media-1", mediaType: "image", downloadStatus: "stored" }],
  });
  const candidateAlbumSecond = message({
    id: "candidate-video",
    mediaGroupId: "candidate-album",
    mediaGroupSource: "protocol_association",
    media: [{ id: "candidate-media-2", mediaType: "video", downloadStatus: "pending" }],
  });

  const grouped = groupWhatsAppMessages([
    requester,
    candidateAlbumFirst,
    candidateAlbumSecond,
  ]);
  const requesterGroup = grouped.find((group) => group.messages[0].id === "requester");

  assert.equal(grouped.length, 2);
  assert.deepEqual(
    requesterGroup.associationSuggestions[0].candidateMedia.map(({ item }) => item.id),
    ["candidate-media-1", "candidate-media-2"],
  );
  assert.deepEqual(
    grouped.map((group) => group.messages.map(({ id }) => id)),
    [["requester"], ["candidate-image", "candidate-video"]],
  );
});

test("keeps suggestion text fallback when candidate media is not in the displayed messages", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "requester",
      associationSuggestions: [{
        sourceMessageId: "requester",
        candidateGroupKey: "message:not-loaded",
        candidateMessageId: "not-loaded",
        candidateText: "مرشح",
        candidateMediaCount: 1,
      }],
    }),
  ]);

  assert.equal(grouped[0].associationSuggestions[0].candidateMedia.length, 0);
  assert.equal(grouped[0].associationSuggestions[0].candidateText, "مرشح");
});

test("keeps cross-page association actions on the loaded candidate card", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "candidate",
      mediaAvailable: true,
      media: [{ id: "candidate-media", mediaType: "image", downloadStatus: "stored" }],
      associationSuggestions: [{
        sourceMessageId: "source-on-another-page",
        candidateMessageId: "candidate",
        candidateGroupKey: "message:candidate",
        candidateText: null,
        candidateMediaCount: 1,
      }],
    }),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].associationSuggestions.length, 1);
  assert.equal(
    grouped[0].associationSuggestions[0].candidateMedia[0].item.id,
    "candidate-media",
  );
});

test("does not display an association suggestion after it has been decided", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "requester",
      contentBundleId: "confirmed-bundle",
      associationSuggestions: [{
        sourceMessageId: "requester",
        candidateGroupKey: "message:candidate",
        candidateMessageId: "candidate",
        candidateText: null,
        candidateMediaCount: 1,
        decision: "accepted",
      }],
    }),
    message({
      id: "candidate",
      contentBundleId: "confirmed-bundle",
    }),
  ]);

  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].messages.map(({ id }) => id), ["requester", "candidate"]);
  assert.deepEqual(grouped[0].associationSuggestions, []);
});

test("moves confirmed album media into the text group's card", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "caption-text",
      contentBundleId: "confirmed-bundle",
      textBody: "نص المنتج",
    }),
    message({
      id: "album-representative",
      contentBundleId: "confirmed-bundle",
      mediaGroupId: "confirmed-album",
      mediaGroupSource: "protocol_association",
      media: [{ id: "album-media-1", downloadStatus: "stored" }],
    }),
    message({
      id: "album-sibling",
      mediaGroupId: "confirmed-album",
      mediaGroupSource: "protocol_association",
      media: [{ id: "album-media-2", downloadStatus: "stored" }],
    }),
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].text, "نص المنتج");
  assert.deepEqual(
    grouped[0].messages.map(({ id }) => id),
    ["caption-text", "album-representative", "album-sibling"],
  );
  assert.deepEqual(
    grouped[0].media.map(({ item }) => item.id),
    ["album-media-1", "album-media-2"],
  );
});

test("shows media fetched through a confirmed content bundle on its message card", () => {
  const grouped = groupWhatsAppMessages([
    message({
      id: "text-only-page-message",
      contentBundleId: "bundle-with-off-page-album",
      textBody: "نص مرتبط بألبوم",
      contentBundleMedia: [
        { id: "off-page-image", mediaType: "image", downloadStatus: "stored" },
      ],
    }),
  ]);

  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].media.map(({ item }) => item.id), ["off-page-image"]);
});

test("allows conversion only when the group has text and complete stored media", () => {
  const complete = {
    text: "نص المنتج",
    media: [
      { item: { downloadStatus: "stored" } },
      { item: { downloadStatus: "stored" } },
    ],
    expectedCount: 2,
    mediaPending: false,
    mediaFailed: false,
  };

  assert.equal(canConvertWhatsAppMessageGroup(complete), true);
  assert.equal(
    canConvertWhatsAppMessageGroup({ ...complete, text: " " }),
    false,
  );
  assert.equal(
    canConvertWhatsAppMessageGroup({ ...complete, media: [] }),
    false,
  );
  assert.equal(
    canConvertWhatsAppMessageGroup({
      ...complete,
      media: [{ item: { downloadStatus: "stored" } }],
    }),
    false,
  );
  assert.equal(
    canConvertWhatsAppMessageGroup({
      ...complete,
      media: [{ item: { downloadStatus: "pending" } }, complete.media[1]],
    }),
    false,
  );
});

test("returns an empty list when there are no messages", () => {
  assert.deepEqual(groupWhatsAppMessages([]), []);
});
