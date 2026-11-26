import assert from "node:assert/strict";
import test from "node:test";

// Import the generated file directly: the package barrel omits file extensions,
// which Node's ESM loader cannot resolve under --experimental-strip-types.
import { ListWhatsAppDirectMessagesResponse } from "../../../../lib/api-zod/src/generated/api.ts";
import {
  buildWhatsAppDirectMediaRow,
  serializeWhatsAppDirectAttachment,
  stripInlineMediaData,
  whatsappDirectMediaFailureLabel,
  whatsappDirectMediaSourceMetadata,
} from "./whatsapp-direct-media.ts";
import { extractMediaItemsFromMessage } from "./whatsapp-message-scope.ts";
import { filterWhatsAppMediaItems } from "./whatsapp-sync-options.ts";

const CONNECTION = {
  syncMessagesEnabled: true,
  syncImagesEnabled: true,
  syncVideosEnabled: true,
};

const IDENTITY = {
  ownerId: "owner-1",
  workspaceId: "workspace-1",
  instanceName: "menaflow-test",
  directMessageId: "dm-1",
  providerMessageId: "A55A85C7",
  remoteJidHash: "f".repeat(64),
};

function imageMessage(caption = null, extra = {}) {
  return {
    key: { id: "A55A85C7", remoteJid: "967777187184@s.whatsapp.net" },
    imageMessage: {
      mimetype: "image/jpeg",
      caption,
      directPath: "/v/t42/967777187184/image.jpg",
      fileSha256: "a".repeat(88),
      fileLength: 2048,
      ...extra,
    },
  };
}

function plan(message, connection = CONNECTION, idPrefix = "media") {
  const items = filterWhatsAppMediaItems(
    extractMediaItemsFromMessage(message),
    connection,
  );
  return items.map((item, mediaIndex) => {
    const sourceMetadata = whatsappDirectMediaSourceMetadata({
      item,
      mediaIndex,
      messageKey: message.key ?? {},
      sourceMessage: item.sourceMessage,
    });
    return {
      item,
      row: buildWhatsAppDirectMediaRow(
        { ...IDENTITY, mediaIndex, item, sourceMetadata },
        `${idPrefix}-${mediaIndex}`,
      ),
    };
  });
}

test("a text-only DM produces no attachment row", () => {
  assert.deepEqual(plan({ conversation: "مرحبًا" }), []);
});

test("an image without a caption is detected by the media node, not by text", () => {
  const planned = plan(imageMessage());
  assert.equal(planned.length, 1);
  assert.equal(planned[0].row.mediaType, "image");
  assert.equal(planned[0].row.mimeType, "image/jpeg");
  assert.equal(planned[0].row.sourceUrl, "/v/t42/967777187184/image.jpg");
  assert.equal(planned[0].row.downloadStatus, "pending");
  assert.equal(planned[0].row.storagePath, null);
});

test("a caption stays metadata and never becomes the attachment", () => {
  const planned = plan(imageMessage("هذه الصورة"))[0];
  assert.equal(planned.item.caption, "هذه الصورة");
  assert.equal(planned.row.sourceMetadata.caption, "هذه الصورة");
  assert.equal("caption" in planned.row, false);
});

test("inline base64 is stripped from stored metadata", () => {
  const planned = plan(imageMessage(null, { base64: "SECRET-BYTES" }))[0];
  const serialized = JSON.stringify(planned.row.sourceMetadata);
  assert.equal(serialized.includes("SECRET-BYTES"), false);
  assert.deepEqual(stripInlineMediaData({ base64: "x", data: "y" }), {});
});

test("video, audio and document messages are each detected", () => {
  const cases = [
    ["videoMessage", "video/mp4", "video"],
    ["audioMessage", "audio/ogg", "audio"],
    ["documentMessage", "application/pdf", "document"],
  ];
  for (const [node, mimetype, expected] of cases) {
    const planned = plan({
      key: IDENTITY,
      [node]: { mimetype, directPath: `/media/${node}`, fileLength: 10 },
    });
    assert.equal(planned.length, 1, node);
    assert.equal(planned[0].row.mediaType, expected, node);
  }
});

test("sync flags apply to direct media without touching the message body", () => {
  const disabled = plan(imageMessage(), {
    ...CONNECTION,
    syncImagesEnabled: false,
  });
  assert.deepEqual(disabled, []);
});

test("a repeated webhook yields the same idempotency identity", () => {
  const first = plan(imageMessage("وصف"), CONNECTION, "first")[0].row;
  const second = plan(imageMessage("وصف"), CONNECTION, "second")[0].row;
  const key = (row) => [
    row.workspaceId,
    row.instanceName,
    row.remoteJidHash,
    row.providerMessageId,
    row.mediaIndex,
    row.mediaType,
  ];
  assert.deepEqual(key(first), key(second));
  assert.notEqual(first.id, second.id);
});

test("download failures keep the text path and expose a diagnosable code", () => {
  const label = whatsappDirectMediaFailureLabel("image", "MEDIA_DOWNLOAD_TIMEOUT");
  assert.match(label, /الصورة/);
  assert.match(label, /MEDIA_DOWNLOAD_TIMEOUT/);
});

test("the inbox attachment wire shape has signed URLs and no storage path", () => {
  const sign = (variant) => ({
    url: `https://api.example.test/media/1?variant=${variant}`,
    accessError: null,
  });
  const view = serializeWhatsAppDirectAttachment(
    {
      id: "media-1",
      mediaIndex: 0,
      mediaType: "image",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      sizeBytes: 2048,
      downloadStatus: "stored",
      errorCode: null,
      storagePath: "secret/photo.jpg",
      thumbnailPath: "secret/thumb.webp",
    },
    sign,
  );
  assert.equal(
    JSON.stringify(view).includes("secret/photo.jpg"),
    false,
  );
  assert.match(view.url, /variant=original/);
  assert.match(view.thumbnailUrl, /variant=thumbnail/);
  const schema = ListWhatsAppDirectMessagesResponse.shape.messages.element.shape
    .attachments.element;
  assert.deepEqual(schema.parse(view), view);
});

test("pending attachments are returned without a URL", () => {
  const view = serializeWhatsAppDirectAttachment(
    {
      id: "media-2",
      mediaIndex: 0,
      mediaType: "video",
      mimeType: "video/mp4",
      fileName: null,
      sizeBytes: null,
      downloadStatus: "pending",
      errorCode: null,
      storagePath: null,
      thumbnailPath: null,
    },
    () => {
      throw new Error("the signer must not be called for pending media");
    },
  );
  assert.equal(view.url, null);
  assert.equal(view.thumbnailUrl, null);
  assert.equal(view.downloadStatus, "pending");
});

test("the shared extractor still feeds group media without group identity leaking into direct rows", () => {
  const groupMessage = {
    key: { id: "GROUP-MEDIA-1", remoteJid: "120363000000000000@g.us" },
    imageMessage: {
      mimetype: "image/png",
      caption: "صورة جماعية",
      directPath: "/v/t42/group/image.png",
      fileSha256: "b".repeat(88),
      fileLength: 4096,
    },
  };
  const groupItems = filterWhatsAppMediaItems(
    extractMediaItemsFromMessage(groupMessage),
    CONNECTION,
  );
  assert.equal(groupItems.length, 1);
  assert.equal(groupItems[0].mediaType, "image");
  assert.equal(groupItems[0].caption, "صورة جماعية");

  const directRow = plan(imageMessage())[0].row;
  assert.equal("groupId" in directRow, false, "direct rows never use a group identity");
  assert.equal("groupJid" in directRow, false);
  assert.equal(directRow.directMessageId, IDENTITY.directMessageId);
});

test("an album yields one idempotency identity per media node", () => {
  const album = {
    key: { id: "ALBUM-1", remoteJid: "967777187184@s.whatsapp.net" },
    albumMessage: {
      messages: [
        { imageMessage: { mimetype: "image/jpeg", directPath: "/a/1", fileLength: 10 } },
        { imageMessage: { mimetype: "image/png", directPath: "/a/2", fileLength: 20 } },
      ],
    },
  };
  const planned = plan(album);
  assert.equal(planned.length, 2);
  assert.deepEqual(planned.map((entry) => entry.row.mediaIndex), [0, 1]);
  assert.deepEqual(planned.map((entry) => entry.row.sourceUrl), ["/a/1", "/a/2"]);
  assert.equal(
    new Set(planned.map((entry) => entry.row.sourceMetadata.mediaIndex)).size,
    2,
  );
});
