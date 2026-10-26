import assert from "node:assert/strict";
import test from "node:test";
import {
  filterHistoryRecordsForGroup,
  extractRemoteJidFromEnvelope,
  isWhatsAppMessageWebhookEvent,
  isSelectedWhatsAppGroupMessage,
  normalizeWhatsAppWebhookEventName,
} from "./whatsapp-message-scope.ts";
import {
  EVOLUTION_GROUP_FETCH_TIMEOUT_MS,
  normalizeEvolutionGroups,
  selectEvolutionGroups,
} from "./whatsapp-groups.ts";
import {
  buildWhatsAppGroupIdentityCandidates,
  resolveWhatsAppGroupSyncTargets,
} from "./whatsapp-group-identity-core.ts";
import {
  extractWhatsAppMediaGroupExpectedCount,
  extractWhatsAppTextFromMessage,
  extractWhatsAppMediaGroupId,
  extractWhatsAppAlbumAssociation,
  extractMediaItemsFromMessage,
  extractWhatsAppWebhookBatch,
  hasWhatsAppMessageContent,
  isWhatsAppAlbumContainer,
} from "./whatsapp-message-scope.ts";
import {
  albumNeedsSettleWait,
  groupWhatsAppAlbumItems,
  hasPreviouslyProcessedAlbumItems,
  whatsappMediaRetryDue,
  whatsappAlbumMediaReady,
  whatsappAlbumProcessingLockKey,
  resolveWhatsAppAlbumSource,
  whatsappAlbumCompletionState,
  whatsappAlbumSettleMs,
  whatsappAlbumMaxWaitMs,
  whatsappAlbumWaitExpired,
  whatsappAlbumId,
  whatsappTextNeedsAssociationWait,
  whatsappTextSettleMs,
  whatsappStandaloneMediaNeedsAssociationWait,
} from "./whatsapp-albums.ts";
import { findWhatsAppAssociationSuggestions } from "./whatsapp-association-suggestions.ts";

const phoneNumber = "+967777187184";

test("uses a bounded timeout for fetching WhatsApp announcement groups", () => {
  assert.equal(EVOLUTION_GROUP_FETCH_TIMEOUT_MS, 60_000);
});

function group(overrides = {}) {
  return {
    id: "120363012345678901@g.us",
    subject: "مجموعة",
    size: 5,
    announce: false,
    participants: [{ id: "967777187184@s.whatsapp.net", admin: null }],
    ...overrides,
  };
}

test("returns announcement groups without using participant data", () => {
  const announcedGroup = group({
    announce: true,
    participants: Array.from({ length: 1000 }, () => ({ admin: "member" })),
  });
  const results = normalizeEvolutionGroups(
    [
      group({ id: "120363012345678902@g.us", announce: false }),
      group({ id: "120363012345678903@g.us", announce: true, isCommunity: true }),
      announcedGroup,
    ],
    phoneNumber,
  );

  assert.deepEqual(results.map(({ groupJid, kind }) => ({ groupJid, kind })), [
    { groupJid: announcedGroup.id, kind: "announcement" },
  ]);
  assert.equal("role" in results[0], false);
  assert.equal("canPublish" in results[0], false);
});

test("selects only announcement groups returned by the linked instance", () => {
  const groups = normalizeEvolutionGroups(
    [
      group({ announce: true }),
      group({ id: "120363000000000002@g.us", announce: false }),
    ],
    phoneNumber,
  );
  assert.deepEqual(
    selectEvolutionGroups(groups, [groups[0].groupJid])?.map(({ groupJid }) => groupJid),
    [groups[0].groupJid],
  );
  assert.equal(
    selectEvolutionGroups(groups, ["120363000000000002@g.us"]),
    undefined,
  );
  assert.equal(
    selectEvolutionGroups(groups, [
      "120363999999999999@g.us",
    ]),
    undefined,
  );
});

test("keeps the linked-group identity separate from its community", () => {
  const announcementJid = "120363012345678902@g.us";
  const communityJid = "120363012345678901@g.us";
  const groups = normalizeEvolutionGroups(
    [
      group({ id: communityJid, isCommunity: true }),
      group({ id: announcementJid, linkedParent: communityJid, announce: true }),
    ],
    phoneNumber,
  );
  assert.deepEqual(groups.map(({ groupJid }) => groupJid), [announcementJid]);
  assert.equal(groups[0].communityParentJid, communityJid);
});

test("extracts the advertised media count from an album", () => {
  assert.equal(
    extractWhatsAppMediaGroupExpectedCount({
      message: {
        albumMessage: {
          messages: [{ imageMessage: {} }, { videoMessage: {} }],
        },
      },
    }),
    2,
  );
});

test("excludes communities while retaining an announcement group's parent JID", () => {
  const announcementJid = "120363012345678902@g.us";
  const communityJid = "120363012345678901@g.us";
  const groups = normalizeEvolutionGroups(
    [
      group({ id: communityJid, isCommunity: true }),
      group({
        id: announcementJid,
        linkedParent: communityJid,
        announce: true,
      }),
    ],
    phoneNumber,
  );

  assert.equal(selectEvolutionGroups(groups, [communityJid]), undefined);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "announcement");
  assert.equal(groups[0].communityParentJid, communityJid);
  assert.notEqual(communityJid, announcementJid);
});

test("expands a selected community to all and only explicitly linked groups", () => {
  const communityJid = "120363012345678901@g.us";
  const announcementJid = "120363012345678902@g.us";
  const regularJid = "120363012345678903@g.us";
  const unrelatedJid = "120363012345678904@g.us";
  const groups = normalizeEvolutionGroups(
    [
      group({
        id: announcementJid,
        linkedParent: communityJid,
        announce: true,
      }),
    ],
    phoneNumber,
  );
  const candidates = buildWhatsAppGroupIdentityCandidates(groups);
  const communityId = "internal-community";
  const announcementId = "internal-announcement";
  const unrelatedId = "internal-unrelated";
  const identities = candidates.map((candidate) => ({
    id: candidate.groupJid === communityJid ? communityId : announcementId,
    kind: candidate.kind,
    parentGroupId: candidate.parentJid
      ? communityId
      : null,
  }));

  assert.deepEqual(
    resolveWhatsAppGroupSyncTargets(
      [identities.find(({ id }) => id === communityId)],
      identities,
    ).map(({ id }) => id).sort(),
    [announcementId],
    resolveWhatsAppGroupSyncTargets(
      [identities.find(({ id }) => id === communityId)],
      identities,
    ).map(({ id }) => id),
    [announcementId],
    () => buildWhatsAppGroupIdentityCandidates([
      { groupJid: "120363012345678901@g.us", kind: "group", name: "Group" },
      { groupJid: "120363012345678901@g.us", kind: "community", name: "Community" },
    ]),
    /WHATSAPP_GROUP_IDENTITY_KIND_CONFLICT/,
  );
});

test("accepts supported response envelopes and rejects malformed group payloads", () => {
  assert.equal(
    normalizeEvolutionGroups({ data: [group({ announce: true })] }, phoneNumber)[0].kind,
    "announcement",
  );
  assert.equal(
    normalizeEvolutionGroups({ data: { groups: [group({ announce: true })] } }, phoneNumber)[0].kind,
    "announcement",
  );
  assert.deepEqual(normalizeEvolutionGroups([], phoneNumber), []);
  assert.throws(
    () => normalizeEvolutionGroups({ count: 0 }, phoneNumber),
    /EVOLUTION_API_INVALID_GROUPS_RESPONSE/,
  );
});

test("filters out records from other WhatsApp groups and direct chats", () => {
  const groupJid = "120363430177130458@g.us";
  const records = [
    { key: { remoteJid: groupJid, id: "msg-1" } },
    {
      key: {
        remoteJid: "120363430177130458@lid",
        remoteJidAlt: groupJid,
        id: "msg-alt",
      },
    },
    { key: { remoteJid: "120363111111111111@g.us", id: "msg-2" } },
    { key: { remoteJid: "966500000000@s.whatsapp.net", id: "msg-3" } },
    { key: { remoteJid: groupJid, id: "msg-4" } },
  ];

  const filtered = filterHistoryRecordsForGroup(records, groupJid);
  assert.deepEqual(
    filtered.map((record) => record.key.id),
    ["msg-1", "msg-alt", "msg-4"],
  );
});

test("requires an exact group remoteJid match before accepting a message", () => {
  const groupJid = "120363430177130458@g.us";
  assert.equal(
    extractRemoteJidFromEnvelope({ key: { remoteJid: "120363430177130458@g.us" } }),
    groupJid,
  );
  assert.equal(
    extractRemoteJidFromEnvelope({ key: { remoteJid: "120363430177130458@broadcast" } }),
    "120363430177130458@broadcast",
  );
  assert.equal(
    filterHistoryRecordsForGroup(
      [
        { key: { remoteJid: "120363430177130458@g.us" } },
        { key: { remoteJid: "120363430177130458@broadcast" } },
      ],
      groupJid,
    ).length,
    1,
  );
});

test("accepts only messages from an explicitly selected WhatsApp group", () => {
  const selectedGroup = "120363430177130458@g.us";
  const unselectedGroup = "120363111111111111@g.us";
  const selectedJids = [selectedGroup];

  assert.equal(
    isSelectedWhatsAppGroupMessage(selectedJids, selectedGroup, selectedGroup),
    true,
  );
  assert.equal(
    isSelectedWhatsAppGroupMessage(selectedJids, unselectedGroup, unselectedGroup),
    false,
  );
  assert.equal(
    isSelectedWhatsAppGroupMessage(
      selectedJids,
      "966500000000@s.whatsapp.net",
      "966500000000@s.whatsapp.net",
    ),
    false,
  );
  assert.equal(
    isSelectedWhatsAppGroupMessage(selectedJids, selectedGroup, null),
    false,
  );
});

test("normalizes Evolution webhook event labels", () => {
  assert.equal(normalizeWhatsAppWebhookEventName("MESSAGES_UPSERT"), "MESSAGES_UPSERT");
  assert.equal(normalizeWhatsAppWebhookEventName("messages.upsert"), "MESSAGES_UPSERT");
  assert.equal(normalizeWhatsAppWebhookEventName("messages.set"), "MESSAGES_SET");
  assert.equal(normalizeWhatsAppWebhookEventName(" messages-update "), "MESSAGES_UPDATE");
  assert.equal(normalizeWhatsAppWebhookEventName(undefined), null);
  assert.equal(isWhatsAppMessageWebhookEvent("MESSAGES_SET"), true);
  assert.equal(isWhatsAppMessageWebhookEvent("MESSAGES_UPSERT"), true);
  assert.equal(isWhatsAppMessageWebhookEvent("QRCODE_UPDATED"), false);
  assert.equal(isWhatsAppMessageWebhookEvent(null), false);
});

test("recognizes batched message sync events and ignores status-only message updates", () => {
  const messages = [
    { key: { id: "image-1" }, message: { imageMessage: { mimetype: "image/jpeg" } } },
    { key: { id: "image-2" }, message: { imageMessage: { mimetype: "image/jpeg" } } },
  ];
  assert.deepEqual(extractWhatsAppWebhookBatch({ data: messages }), messages);
  assert.deepEqual(extractWhatsAppWebhookBatch({ data: { messages } }), messages);
  assert.equal(extractWhatsAppWebhookBatch({ data: messages[0] }), null);
  assert.equal(hasWhatsAppMessageContent({ status: "READ", key: { id: "image-1" } }), false);
  assert.equal(hasWhatsAppMessageContent({ conversation: "وصف المنشور" }), true);
  assert.equal(
    hasWhatsAppMessageContent({ message: { imageMessage: { mimetype: "image/jpeg" } } }),
    true,
  );
});

test("extracts original text from wrapped Evolution message and album captions", () => {
  assert.equal(
    extractWhatsAppTextFromMessage({
      ephemeralMessage: {
        message: { extendedTextMessage: { text: "وصف المنتج" } },
      },
    }),
    "وصف المنتج",
  );
  assert.equal(
    extractWhatsAppTextFromMessage({
      albumMessage: {
        messages: [
          { imageMessage: { caption: "تفاصيل المنتج" } },
          { videoMessage: { caption: "تفاصيل المنتج" } },
        ],
      },
    }),
    "تفاصيل المنتج",
  );
});

test("reads expected image and video counts from album association metadata", () => {
  assert.equal(
    extractWhatsAppMediaGroupExpectedCount({
      messageContextInfo: {
        messageAssociation: {
          associationType: 1,
          expectedImageCount: 6,
          expectedVideoCount: 1,
        },
      },
    }),
    7,
  );
});

test("accepts nested JIDs and string booleans from Evolution responses", () => {
  assert.equal(
    extractRemoteJidFromEnvelope({ data: { key: { remoteJid: "120363430177130458@g.us" } } }),
    "120363430177130458@g.us",
  );

  const [result] = normalizeEvolutionGroups(
    [{
      id: "120363012345678901@g.us",
      subject: "مجموعة",
      size: "12",
      announce: "true",
      participants: [{ id: "967777187184@s.whatsapp.net", admin: "ADMIN" }],
    }],
    phoneNumber,
  );

  assert.equal(result.kind, "announcement");
  assert.equal("participantCount" in result, false);
  assert.equal("role" in result, false);
});

test("one six-image WhatsApp album with one caption forms one source post with six media", () => {
  const timestamp = new Date("2026-10-12T10:00:00Z");
  const album = {
    conversation: "وصف موحد للمنتج",
    albumMessage: {
      messages: Array.from({ length: 6 }, (_, index) => ({
        imageMessage: {
          mimetype: "image/jpeg",
          base64: `image-${index}`,
        },
      })),
    },
  };
  const extracted = extractMediaItemsFromMessage(album);
  assert.equal(extracted.length, 6);
  assert.ok(extracted.every((item) => item.mediaType === "image"));
  assert.ok(extracted.every((item) => item.caption === album.conversation));

  const groupId = `album:${"remote-album-message"}`;
  const grouped = groupWhatsAppAlbumItems(extracted.map((item, index) => ({
    ...item,
    messageId: "remote-album-message",
    mediaGroupId: groupId,
    mediaGroupSource: "provider_album_container",
    mediaType: item.mediaType,
    caption: item.caption,
    senderId: "business@s.whatsapp.net",
    mediaIndex: index,
  })));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].sourceId, groupId);
  assert.equal(grouped[0].items.length, 6);
});

test("Evolution text and six associated image upserts aggregate to one complete post in either arrival order", () => {
  const groupJid = "120363012345678901@g.us";
  const parentMessageId = "product-description-message";
  const ownerId = "owner-1";
  const instanceName = "evolution-instance";
  const mediaGroupId = whatsappAlbumId({ ownerId, instanceName, groupJid, parentMessageId });
  const textEvent = {
    event: "messages.upsert",
    instance: instanceName,
    data: {
      key: { id: parentMessageId, remoteJid: groupJid, fromMe: true },
      messageTimestamp: 1_791_797_200,
      message: { conversation: "وسادة طبية مريحة لدعم الظهر" },
    },
  };
  const imageEvents = Array.from({ length: 6 }, (_, index) => ({
    event: "messages.upsert",
    instance: instanceName,
    data: {
      key: {
        id: `product-image-${index}`,
        remoteJid: groupJid,
        participant: "seller@s.whatsapp.net",
      },
      messageTimestamp: 1_791_797_201 + index,
      message: {
        imageMessage: { mimetype: "image/jpeg", caption: index === 0 ? "وسادة طبية مريحة لدعم الظهر" : undefined },
        messageContextInfo: {
          messageAssociation: {
            associationType: 1,
            parentMessageKey: { id: parentMessageId, remoteJid: groupJid },
            messageIndex: index,
            expectedImageCount: 6,
          },
        },
      },
    },
  }));
  const normalized = (events) => {
    const byRemoteId = new Map();
    for (const event of events) {
      const key = event.data.key;
      const association = extractWhatsAppAlbumAssociation(event.data.message);
      const resolved = resolveWhatsAppAlbumSource({
        ownerId,
        instanceName,
        groupJid,
        remoteMessageId: key.id,
        mediaItemCount: extractMediaItemsFromMessage(event.data.message).length,
        mediaGroupMarker: extractWhatsAppMediaGroupId(event.data.message),
        advertisedMediaCount: extractWhatsAppMediaGroupExpectedCount(event.data.message),
        isAlbumContainer: isWhatsAppAlbumContainer(event.data.message),
        association,
      });
      const rowGroupId = resolved.mediaGroupId ?? (
        key.id === parentMessageId && byRemoteId.has(parentMessageId)
          ? mediaGroupId
          : key.id === parentMessageId && events.some((item) =>
            extractWhatsAppAlbumAssociation(item.data.message)?.parentMessageId === parentMessageId,
          )
            ? mediaGroupId
            : null
      );
      const media = extractMediaItemsFromMessage(event.data.message);
      byRemoteId.set(key.id, {
        messageId: key.id,
        mediaGroupId: rowGroupId,
        mediaGroupSource: rowGroupId ? "protocol_association" : null,
        mediaType: media.length ? media[0].mediaType : "text",
        caption: media[0]?.caption ?? event.data.message.conversation ?? null,
        senderId: key.participant ?? null,
      });
    }
    return [...byRemoteId.values()];
  };
  for (const events of [
    [textEvent, ...imageEvents],
    [...imageEvents, textEvent],
    [textEvent, ...imageEvents, ...imageEvents],
  ]) {
    const rows = normalized(events);
    const groups = groupWhatsAppAlbumItems(rows);
    const completed = new Map(groups.map((group) => [group.sourceId, group.items]));
    assert.equal(completed.size, 1);
    assert.equal(completed.get(mediaGroupId).length, 7);
    assert.equal(completed.get(mediaGroupId).filter((item) => item.mediaType === "image").length, 6);
    assert.equal(
      completed.get(mediaGroupId).find((item) => item.messageId === parentMessageId).caption,
      "وسادة طبية مريحة لدعم الظهر",
    );
    assert.equal(extractWhatsAppMediaGroupExpectedCount(imageEvents[0]), 6);
    assert.equal(new Set(groups.map((group) => group.sourceId)).size, 1);
  }
});

test("text without a known association waits briefly while unrelated messages remain separate", () => {
  const createdAt = new Date("2026-10-12T10:00:00Z");
  const settleMs = whatsappTextSettleMs(5_000);
  assert.equal(whatsappTextNeedsAssociationWait({
    hasMediaGroup: false,
    hasMedia: false,
    hasText: true,
    createdAt,
    now: new Date("2026-10-12T10:00:04Z"),
    settleMs,
  }), true);
  assert.equal(whatsappTextNeedsAssociationWait({
    hasMediaGroup: false,
    hasMedia: false,
    hasText: true,
    createdAt,
    now: new Date("2026-10-12T10:00:05Z"),
    settleMs,
  }), false);
  assert.equal(whatsappTextNeedsAssociationWait({
    hasMediaGroup: false,
    hasMedia: false,
    hasText: true,
    createdAt,
    now: new Date("2026-10-12T10:00:01Z"),
    settleMs,
  }), true);

  const groups = groupWhatsAppAlbumItems([
    { messageId: "independent-text-1", mediaGroupId: null, mediaType: "text", caption: "وسادة" },
    { messageId: "independent-text-2", mediaGroupId: null, mediaType: "text", caption: "وسادة" },
    { messageId: "independent-image-1", mediaGroupId: null, mediaType: "image", caption: "وسادة" },
  ]);
  assert.equal(groups.length, 3);
});

test("nearby messages produce review suggestions without merging independent identities", () => {
  const baseTime = new Date("2026-10-12T10:00:00Z");
  const messages = [
    {
      id: "text-row",
      remoteMessageId: "description",
      senderId: "seller",
      textBody: "نص متكرر",
      caption: null,
      mediaAvailable: false,
      mediaGroupId: null,
      mediaGroupSource: null,
      messageTimestamp: baseTime.toISOString(),
      createdAt: baseTime.toISOString(),
      replyToRemoteId: null,
      mediaCount: 0,
    },
    ...["image-one", "image-two"].map((id, index) => ({
      id,
      remoteMessageId: id,
      senderId: "seller",
      textBody: null,
      caption: "نص متكرر",
      mediaAvailable: true,
      mediaGroupId: null,
      mediaGroupSource: null,
      messageTimestamp: new Date(baseTime.getTime() + index * 500).toISOString(),
      createdAt: new Date(baseTime.getTime() + index * 500).toISOString(),
      replyToRemoteId: null,
      mediaCount: 1,
    })),
  ];

  const suggestions = findWhatsAppAssociationSuggestions(messages);
  assert.equal(suggestions.get("text-row").length, 2);
  assert.deepEqual(
    suggestions.get("text-row").map((item) => item.candidateMessageId),
    ["image-one", "image-two"],
  );
  assert.ok(messages.slice(1).every((item) => item.mediaGroupId === null));
});

test("standalone media waits through the association window before individual draft processing", () => {
  const createdAt = new Date("2026-10-12T10:00:00Z");
  assert.equal(whatsappStandaloneMediaNeedsAssociationWait({
    hasKnownGroup: false,
    createdAt,
    now: new Date("2026-10-12T10:00:14Z"),
    settleMs: 5_000,
    associationWindowMs: 5_000,
  }), true);
  assert.equal(whatsappStandaloneMediaNeedsAssociationWait({
    hasKnownGroup: false,
    createdAt,
    now: new Date("2026-10-12T10:00:15Z"),
    settleMs: 5_000,
    associationWindowMs: 5_000,
  }), false);
  assert.equal(whatsappStandaloneMediaNeedsAssociationWait({
    hasKnownGroup: true,
    createdAt,
    now: new Date("2026-10-12T10:00:01Z"),
    settleMs: 5_000,
    associationWindowMs: 5_000,
  }), false);
});

test("a standalone text near an album remains a review suggestion, not an album relation", () => {
  const textEvent = {
    event: "messages.upsert",
    data: {
      key: { id: "water-hose-description", remoteJid: "120363012345678901@g.us" },
      message: { conversation: "خرطوم الماء المرن والممتد" },
    },
  };
  const albumEvent = {
    event: "messages.upsert",
    data: {
      key: { id: "water-hose-album", remoteJid: "120363012345678901@g.us" },
      messageType: "albumMessage",
      message: { albumMessage: { expectedImageCount: 5, expectedVideoCount: 0 } },
    },
  };
  assert.equal(isWhatsAppAlbumContainer(albumEvent.data.message), true);
  assert.equal(extractWhatsAppAlbumAssociation(albumEvent.data.message), null);
  const suggestions = findWhatsAppAssociationSuggestions([
    {
      id: "text",
      remoteMessageId: textEvent.data.key.id,
      senderId: "seller",
      textBody: textEvent.data.message.conversation,
      caption: null,
      mediaAvailable: false,
      mediaGroupId: null,
      mediaGroupSource: null,
      messageTimestamp: "2026-10-12T13:06:26.445Z",
      createdAt: "2026-10-12T13:06:26.445Z",
      replyToRemoteId: null,
      mediaCount: 0,
    },
    {
      id: "album",
      remoteMessageId: albumEvent.data.key.id,
      senderId: "seller",
      textBody: null,
      caption: "خرطوم الماء المرن والممتد",
      mediaAvailable: true,
      mediaGroupId: "confirmed-album-id",
      mediaGroupSource: "provider_album_container",
      messageTimestamp: "2026-10-12T13:06:41.445Z",
      createdAt: "2026-10-12T13:06:41.445Z",
      replyToRemoteId: null,
      mediaCount: 5,
    },
  ]);
  assert.equal(suggestions.get("text")[0].decision, undefined);
  assert.equal(suggestions.get("text")[0].candidateMediaGroupId, "confirmed-album-id");
});

test("two independent WhatsApp images stay in separate source posts", () => {
  const groups = groupWhatsAppAlbumItems([
    { messageId: "image-one", mediaGroupId: null, mediaType: "image", caption: "وصف متطابق", senderId: "same-sender" },
    { messageId: "image-two", mediaGroupId: null, mediaType: "image", caption: "وصف متطابق", senderId: "same-sender" },
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => group.items.length), [1, 1]);
  const uncaptionedGroups = groupWhatsAppAlbumItems([
    { messageId: "standalone-one", mediaGroupId: null, mediaType: "image", caption: null, senderId: "same-sender" },
    { messageId: "standalone-two", mediaGroupId: null, mediaType: "image", caption: null, senderId: "same-sender" },
  ]);
  assert.equal(uncaptionedGroups.length, 2);
});

test("Baileys MEDIA_ALBUM parent key groups individual MESSAGES_UPSERT events", () => {
  const groupJid = "120363012345678901@g.us";
  const parentMessageId = "album-parent-42";
  const albums = Array.from({ length: 6 }, (_, index) => ({
    event: "MESSAGES_UPSERT",
    data: {
      key: { id: `media-${index}`, remoteJid: groupJid, participant: "seller@s.whatsapp.net" },
      message: {
        imageMessage: { mimetype: "image/jpeg", caption: index === 0 ? "وصف واحد للألبوم" : undefined },
        messageContextInfo: {
          messageAssociation: {
            associationType: 1,
            parentMessageKey: { id: parentMessageId, remoteJid: groupJid },
            messageIndex: index,
          },
        },
      },
    },
  }));
  const container = {
    data: {
      key: { id: parentMessageId, remoteJid: groupJid },
      messageType: "albumMessage",
      message: { albumMessage: { expectedImageCount: 6, expectedVideoCount: 0 } },
    },
  };
  assert.equal(extractWhatsAppMediaGroupExpectedCount(container), 6);
  assert.equal(isWhatsAppAlbumContainer(container), true);
  const containerSource = resolveWhatsAppAlbumSource({
    ownerId: "owner-1",
    instanceName: "instance-1",
    groupJid,
    remoteMessageId: parentMessageId,
    mediaItemCount: 0,
    mediaGroupMarker: null,
    advertisedMediaCount: extractWhatsAppMediaGroupExpectedCount(container),
    isAlbumContainer: true,
    association: null,
  });
  const mediaGroupId = containerSource.mediaGroupId;
  assert.ok(mediaGroupId);
  assert.equal(containerSource.mediaGroupExpectedCount, 6);
  const indexedItems = albums.toReversed().map((event) => {
    const association = extractWhatsAppAlbumAssociation(event.data.message);
    assert.equal(association?.parentMessageId, parentMessageId);
    assert.equal(association?.parentRemoteJid, groupJid);
    const media = extractMediaItemsFromMessage(event.data.message)[0];
    const resolved = resolveWhatsAppAlbumSource({
      ownerId: "owner-1",
      instanceName: "instance-1",
      groupJid,
      remoteMessageId: event.data.key.id,
      mediaItemCount: 1,
      mediaGroupMarker: extractWhatsAppMediaGroupId(event.data.message),
      advertisedMediaCount: null,
      isAlbumContainer: false,
      association,
    });
    assert.equal(resolved.mediaGroupId, mediaGroupId);
    return {
      messageId: event.data.key.id,
      mediaGroupId: resolved.mediaGroupId,
      mediaGroupSource: "protocol_association",
      mediaType: media.mediaType,
      caption: media.caption,
      senderId: event.data.key.participant,
      mediaGroupIndex: association.messageIndex,
    };
  });
  const groups = groupWhatsAppAlbumItems(indexedItems);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 6);
  const sourcePosts = new Map();
  for (const item of groups[0].items) {
    const sourcePost = sourcePosts.get(groups[0].sourceId) ?? new Set();
    sourcePost.add(item.messageId);
    sourcePosts.set(groups[0].sourceId, sourcePost);
  }
  assert.equal(sourcePosts.size, 1);
  assert.equal(sourcePosts.get(groups[0].sourceId).size, 6);
  assert.deepEqual(
    groups[0].items.toSorted((left, right) => left.mediaGroupIndex - right.mediaGroupIndex)
      .map((item) => item.messageId),
    ["media-0", "media-1", "media-2", "media-3", "media-4", "media-5"],
  );
  assert.equal(whatsappAlbumId({
    ownerId: "owner-1",
    instanceName: "instance-1",
    groupJid,
    parentMessageId,
  }), mediaGroupId);
  const upserted = new Map();
  for (const event of [...albums, ...albums]) upserted.set(event.data.key.id, event);
  assert.equal(upserted.size, 6);
  assert.equal(groupWhatsAppAlbumItems([...upserted.values()].map((event) => ({
    messageId: event.data.key.id,
    mediaGroupId,
    mediaGroupSource: "protocol_association",
    mediaType: "image",
    caption: null,
    senderId: event.data.key.participant,
  })))[0].items.length, 6);
});

test("legacy mediaGroupId values without a known source remain separate", () => {
  const groups = groupWhatsAppAlbumItems([
    { messageId: "legacy-one", mediaGroupId: "legacy-id", mediaType: "image", caption: null },
    { messageId: "legacy-two", mediaGroupId: "legacy-id", mediaType: "image", caption: null },
  ]);
  assert.equal(groups.length, 2);
});

test("album processing waits for late media, but processes a complete expected batch immediately", () => {
  const now = new Date("2026-10-12T10:00:10Z");
  assert.equal(albumNeedsSettleWait({
    expectedCount: 6,
    actualCount: 5,
    latestUpdate: new Date("2026-10-12T10:00:09Z"),
    now,
    settleMs: 5_000,
  }), true);
  assert.equal(whatsappAlbumMediaReady({
    expectedCount: 6,
    storedCount: 5,
    pendingOrFailedDownload: false,
  }), false);
  assert.equal(albumNeedsSettleWait({
    expectedCount: 6,
    actualCount: 5,
    latestUpdate: new Date("2026-10-12T10:00:09Z"),
    now: new Date("2026-10-12T10:05:00Z"),
    settleMs: 5_000,
  }), true);
  assert.equal(albumNeedsSettleWait({
    expectedCount: 6,
    actualCount: 6,
    latestUpdate: new Date("2026-10-12T10:00:09Z"),
    now,
    settleMs: 5_000,
  }), false);
  assert.equal(albumNeedsSettleWait({
    expectedCount: 0,
    actualCount: 5,
    latestUpdate: new Date("2026-10-12T10:00:00Z"),
    now: new Date("2026-10-12T10:00:04Z"),
    settleMs: 5_000,
  }), true);
  assert.equal(albumNeedsSettleWait({
    expectedCount: 0,
    actualCount: 6,
    latestUpdate: new Date("2026-10-12T10:00:00Z"),
    now: new Date("2026-10-12T10:30:00Z"),
    settleMs: 5_000,
  }), false);
  assert.equal(albumNeedsSettleWait({
    expectedCount: 0,
    actualCount: 1,
    latestUpdate: new Date("2026-10-12T10:00:00Z"),
    now: new Date("2026-10-12T10:30:00Z"),
    settleMs: 5_000,
  }), false);
  assert.equal(whatsappAlbumMediaReady({
    expectedCount: 6,
    storedCount: 6,
    pendingOrFailedDownload: false,
  }), true);
  assert.equal(whatsappAlbumMediaReady({
    expectedCount: 6,
    storedCount: 6,
    pendingOrFailedDownload: true,
  }), false);
});

test("album media-download failures stay blocked and group lock is shared across message jobs", () => {
  assert.equal(whatsappAlbumMediaReady({
    expectedCount: 5,
    storedCount: 4,
    pendingOrFailedDownload: true,
  }), false);
  const failedAt = new Date("2026-10-12T10:00:00Z");
  assert.equal(whatsappMediaRetryDue("failed", failedAt, new Date("2026-10-12T10:00:29Z")), false);
  assert.equal(whatsappMediaRetryDue("failed", failedAt, new Date("2026-10-12T10:00:30Z")), true);
  assert.equal(whatsappMediaRetryDue("stored", failedAt, new Date("2026-10-12T10:01:00Z")), false);
  const parentGroup = "album:stable";
  assert.equal(
    whatsappAlbumProcessingLockKey("owner-1", parentGroup, "message-one"),
    whatsappAlbumProcessingLockKey("owner-1", parentGroup, "message-two"),
  );
  assert.notEqual(
    whatsappAlbumProcessingLockKey("owner-1", parentGroup, "message-one"),
    whatsappAlbumProcessingLockKey("owner-1", null, "message-one"),
  );
  assert.equal(
    hasPreviouslyProcessedAlbumItems("album-source", ["message-1", "message-2"], ["message-1"]),
    true,
  );
  assert.equal(
    hasPreviouslyProcessedAlbumItems("album-source", ["message-1", "message-2"], ["album-source"]),
    false,
  );
});

test("incomplete albums are never complete by timeout and become review drafts instead", () => {
  const firstSeenAt = new Date("2026-10-12T10:00:00Z");
  const maxWaitMs = 30 * 60_000;
  const base = {
    expectedCount: 10,
    storedCount: 9,
    isAlbum: true,
    hasAlbumContainer: false,
    hasMediaGroup: true,
    hasPendingDownload: false,
    hasMissingMessageMedia: false,
    hasTerminalDownloadFailure: true,
    firstSeenAt,
    latestUpdate: firstSeenAt,
    settleMs: 5_000,
    maxWaitMs,
  };

  const beforeTimeout = whatsappAlbumCompletionState({
    ...base,
    now: new Date(firstSeenAt.getTime() + maxWaitMs - 1),
  });
  assert.equal(beforeTimeout.shouldWait, true);
  assert.equal(beforeTimeout.reviewRequired, false);
  assert.equal(beforeTimeout.mediaReady, false);

  const afterTimeout = whatsappAlbumCompletionState({
    ...base,
    now: new Date(firstSeenAt.getTime() + maxWaitMs),
  });
  assert.equal(afterTimeout.reviewRequired, true);
  assert.equal(afterTimeout.mediaReady, false);

  const stillDownloading = whatsappAlbumCompletionState({
    ...base,
    hasPendingDownload: true,
    now: new Date(firstSeenAt.getTime() + maxWaitMs),
  });
  assert.equal(stillDownloading.reviewRequired, false);
  assert.equal(stillDownloading.shouldWait, true);
});

test("unknown album counts require review, while exact advertised counts prove completion", () => {
  const firstSeenAt = new Date("2026-10-12T10:00:00Z");
  const now = new Date(firstSeenAt.getTime() + 30 * 60_000);
  const unknown = whatsappAlbumCompletionState({
    expectedCount: 0,
    storedCount: 2,
    isAlbum: true,
    hasAlbumContainer: false,
    hasMediaGroup: true,
    hasPendingDownload: false,
    hasMissingMessageMedia: false,
    hasTerminalDownloadFailure: false,
    firstSeenAt,
    latestUpdate: firstSeenAt,
    now,
    settleMs: 5_000,
    maxWaitMs: 30 * 60_000,
  });
  assert.equal(unknown.reviewRequired, true);
  assert.equal(unknown.mediaReady, false);

  const complete = whatsappAlbumCompletionState({
    expectedCount: 2,
    storedCount: 2,
    isAlbum: true,
    hasAlbumContainer: false,
    hasMediaGroup: true,
    hasPendingDownload: false,
    hasMissingMessageMedia: false,
    hasTerminalDownloadFailure: false,
    firstSeenAt,
    latestUpdate: firstSeenAt,
    now,
    settleMs: 5_000,
    maxWaitMs: 30 * 60_000,
  });
  assert.equal(complete.shouldWait, false);
  assert.equal(complete.reviewRequired, false);
  assert.equal(complete.mediaReady, true);

  const failedItem = whatsappAlbumCompletionState({
    expectedCount: 2,
    storedCount: 2,
    isAlbum: true,
    hasAlbumContainer: false,
    hasMediaGroup: true,
    hasPendingDownload: false,
    hasMissingMessageMedia: false,
    hasTerminalDownloadFailure: true,
    firstSeenAt,
    latestUpdate: firstSeenAt,
    now,
    settleMs: 5_000,
    maxWaitMs: 30 * 60_000,
  });
  assert.equal(failedItem.mediaReady, false);
});

test("album grouping and settle windows are bounded and configurable", () => {
  assert.equal(whatsappAlbumSettleMs("8000"), 8_000);
  assert.equal(whatsappAlbumSettleMs("invalid"), 5_000);
  assert.equal(whatsappAlbumSettleMs("100"), 1_000);
  assert.equal(whatsappAlbumMaxWaitMs("3600000"), 3_600_000);
  assert.equal(whatsappAlbumMaxWaitMs("invalid"), 30 * 60_000);
  assert.equal(whatsappAlbumWaitExpired({
    firstSeenAt: new Date("2026-10-12T10:00:00Z"),
    now: new Date("2026-10-12T10:29:59Z"),
    maxWaitMs: 30 * 60_000,
  }), false);
  assert.equal(whatsappAlbumWaitExpired({
    firstSeenAt: new Date("2026-10-12T10:00:00Z"),
    now: new Date("2026-10-12T10:30:00Z"),
    maxWaitMs: 30 * 60_000,
  }), true);
  assert.equal(whatsappAlbumSettleMs("60000"), 30_000);
});

test("provider album IDs and declared media counts survive nested webhook envelopes", () => {
  const webhook = {
    data: {
      key: { id: "remote-1" },
      message: {
        albumMessage: {
          mediaGroupId: "provider-album-7",
          expectedMediaCount: 5,
        },
      },
    },
  };
  assert.equal(extractWhatsAppMediaGroupId(webhook), "provider-album-7");
  assert.equal(extractWhatsAppMediaGroupExpectedCount(webhook), 5);
  assert.equal(extractWhatsAppMediaGroupExpectedCount({
    data: { message: { albumMessage: { expectedImageCount: 4, expectedVideoCount: 1 } } },
  }), 5);
});
