import assert from "node:assert/strict";
import test from "node:test";
import { extractWhatsAppTextFromMessage } from "./whatsapp-message-scope.ts";
import { resolveWhatsAppAlbumSource } from "./whatsapp-albums.ts";
import {
  canShareWhatsAppMediaGroup,
  resolveWhatsAppMediaGroupSource,
} from "./whatsapp-album-relations.ts";
import {
  areWhatsAppMessagesInSameContentScope,
  connectedWhatsAppMessageIds,
  normalizeWhatsAppAssociationPair,
  whatsappAssociationPairKey,
} from "./whatsapp-content-association-logic.ts";
import { findWhatsAppAssociationSuggestions } from "./whatsapp-association-suggestions.ts";

const groupJid = "120363012345678901@g.us";
const albumScope = {
  ownerId: "owner",
  instanceName: "instance",
  groupJid,
};

function suggestionMessage(overrides = {}) {
  const timestamp = "2026-10-27T00:00:00.000Z";
  return {
    id: "message",
    remoteMessageId: "remote-message",
    senderId: "sender",
    textBody: null,
    caption: null,
    mediaAvailable: false,
    mediaGroupId: null,
    mediaGroupSource: null,
    messageTimestamp: timestamp,
    createdAt: timestamp,
    replyToRemoteId: null,
    mediaCount: 0,
    ...overrides,
  };
}

test("keeps image captions on their original standalone message", () => {
  const image = {
    imageMessage: { caption: "صورة منتج" },
  };
  assert.equal(extractWhatsAppTextFromMessage(image), "صورة منتج");
  assert.equal(resolveWhatsAppAlbumSource({
    ...albumScope,
    remoteMessageId: "standalone-image",
    mediaItemCount: 1,
    mediaGroupMarker: null,
    advertisedMediaCount: null,
    isAlbumContainer: false,
    association: null,
  }).mediaGroupId, null);
});

test("uses a valid album parent and preserves ordering data for out-of-order incomplete albums", () => {
  const parentMessageId = "album-parent";
  const parentId = resolveWhatsAppAlbumSource({
    ...albumScope,
    remoteMessageId: parentMessageId,
    mediaItemCount: 0,
    mediaGroupMarker: null,
    advertisedMediaCount: 4,
    isAlbumContainer: true,
    association: null,
  });
  const association = {
    parentMessageId,
    parentRemoteJid: groupJid,
    messageIndex: 2,
  };
  const child = resolveWhatsAppAlbumSource({
    ...albumScope,
    remoteMessageId: "late-child",
    mediaItemCount: 1,
    mediaGroupMarker: null,
    advertisedMediaCount: null,
    isAlbumContainer: false,
    association,
  });
  assert.equal(child.mediaGroupId, parentId.mediaGroupId);
  assert.equal(child.mediaGroupExpectedCount, null);
  assert.equal(child.mediaGroupIndex, 2);
  assert.equal(parentId.mediaGroupExpectedCount, 4);
  assert.equal(resolveWhatsAppMediaGroupSource({
    hasValidProtocolAssociation: true,
    isProviderAlbumContainer: false,
  }), "protocol_association");
});

test("retains provider candidates without merging close products or repeated text", () => {
  const time = Date.parse("2026-10-27T00:00:00.000Z");
  const textBefore = suggestionMessage({
    id: "text-before",
    remoteMessageId: "text-before-remote",
    textBody: "منتج واحد",
  });
  const firstProduct = suggestionMessage({
    id: "image-first",
    remoteMessageId: "image-first-remote",
    mediaAvailable: true,
    caption: "منتج واحد",
    mediaCount: 1,
    messageTimestamp: new Date(time + 500).toISOString(),
    createdAt: new Date(time + 500).toISOString(),
  });
  const secondProduct = suggestionMessage({
    id: "image-second",
    remoteMessageId: "image-second-remote",
    mediaAvailable: true,
    caption: "منتج واحد",
    mediaCount: 1,
    messageTimestamp: new Date(time + 1_000).toISOString(),
    createdAt: new Date(time + 1_000).toISOString(),
  });
  const textAfterAlbum = suggestionMessage({
    id: "text-after",
    remoteMessageId: "text-after-remote",
    textBody: "منتج واحد",
    messageTimestamp: new Date(time + 1_500).toISOString(),
    createdAt: new Date(time + 1_500).toISOString(),
  });

  const suggestions = findWhatsAppAssociationSuggestions([
    textBefore,
    firstProduct,
    secondProduct,
    textAfterAlbum,
  ]);
  assert.deepEqual(
    suggestions.get("text-before").map((item) => item.candidateMessageId),
    ["image-first", "image-second"],
  );
  assert.deepEqual(
    suggestions.get("text-after").map((item) => item.candidateMessageId),
    ["image-first", "image-second"],
  );
  assert.ok([textBefore, firstProduct, secondProduct, textAfterAlbum]
    .every((message) => message.mediaGroupId === null));
});

test("does not suggest across different or missing sender identities", () => {
  const text = suggestionMessage({
    id: "text",
    remoteMessageId: "text-remote",
    textBody: "وصف",
  });
  const suggestions = findWhatsAppAssociationSuggestions([
    text,
    suggestionMessage({
      id: "different-sender",
      senderId: "another-sender",
      mediaAvailable: true,
      mediaCount: 1,
    }),
    suggestionMessage({
      id: "unknown-sender",
      senderId: null,
      mediaAvailable: true,
      mediaCount: 1,
    }),
  ]);
  assert.equal(suggestions.has("text"), false);
  assert.equal(findWhatsAppAssociationSuggestions([
    { ...text, senderId: null },
    suggestionMessage({ id: "media", mediaAvailable: true, mediaCount: 1 }),
  ]).size, 0);
});

test("only provider-verified identities share a media group", () => {
  assert.equal(canShareWhatsAppMediaGroup({
    mediaGroupId: "legacy-id",
    source: null,
    candidateMediaGroupId: "legacy-id",
    candidateSource: null,
  }), false);
  assert.equal(canShareWhatsAppMediaGroup({
    mediaGroupId: "album-id",
    source: "protocol_association",
    candidateMediaGroupId: "album-id",
    candidateSource: "provider_album_container",
  }), true);
});

test("accepted relationships form a bundle; rejected and undecided pairs do not", () => {
  const edges = [
    { leftMessageId: "a", rightMessageId: "b", decision: "accepted" },
    { leftMessageId: "b", rightMessageId: "c", decision: "accepted" },
    { leftMessageId: "c", rightMessageId: "d", decision: "rejected" },
  ];
  assert.deepEqual(connectedWhatsAppMessageIds("a", edges), ["a", "b", "c"]);
  assert.deepEqual(connectedWhatsAppMessageIds("d", edges), ["d"]);
  assert.deepEqual(normalizeWhatsAppAssociationPair("z", "a"), ["a", "z"]);
  assert.equal(whatsappAssociationPairKey("a", "b"), whatsappAssociationPairKey("b", "a"));
});

test("association scopes reject workspace, connection, and group crossings", () => {
  const first = {
    workspaceId: "workspace-a",
    ownerId: "owner-a",
    instanceName: "instance-a",
    groupId: "group-a",
    groupJid,
  };
  assert.equal(areWhatsAppMessagesInSameContentScope(first, { ...first }), true);
  assert.equal(areWhatsAppMessagesInSameContentScope(first, {
    ...first,
    workspaceId: "workspace-b",
  }), false);
  assert.equal(areWhatsAppMessagesInSameContentScope(first, {
    ...first,
    instanceName: "instance-b",
  }), false);
  assert.equal(areWhatsAppMessagesInSameContentScope(first, {
    ...first,
    groupId: "group-b",
  }), false);
  assert.equal(areWhatsAppMessagesInSameContentScope(first, {
    ...first,
    groupId: null,
  }), false);
});

test("repeated webhook delivery cannot create duplicate relation pair identities", () => {
  const first = whatsappAssociationPairKey("text-id", "media-id");
  const replay = whatsappAssociationPairKey("media-id", "text-id");
  assert.equal(first, replay);
});
