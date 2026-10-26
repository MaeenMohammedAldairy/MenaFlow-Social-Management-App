import assert from "node:assert/strict";
import test from "node:test";
import {
  filterWhatsAppMediaItems,
  hasEnabledWhatsAppSyncType,
  shouldSyncWhatsAppMessage,
} from "./whatsapp-sync-options.ts";

const media = [
  { mediaType: "image" },
  { mediaType: "video" },
  { mediaType: "audio" },
  { mediaType: "document" },
];

test("requires an enabled message or media type before starting a sync", () => {
  assert.equal(
    hasEnabledWhatsAppSyncType({
      syncMessagesEnabled: false,
      syncImagesEnabled: false,
      syncVideosEnabled: false,
    }),
    false,
  );
  assert.equal(
    hasEnabledWhatsAppSyncType({
      syncMessagesEnabled: false,
      syncImagesEnabled: true,
      syncVideosEnabled: false,
    }),
    true,
  );
});

test("syncing images only excludes video and other media", () => {
  assert.deepEqual(
    filterWhatsAppMediaItems(media, {
      syncMessagesEnabled: false,
      syncImagesEnabled: true,
      syncVideosEnabled: false,
    }),
    [{ mediaType: "image" }],
  );
});

test("syncing videos only excludes images and other media", () => {
  assert.deepEqual(
    filterWhatsAppMediaItems(media, {
      syncMessagesEnabled: false,
      syncImagesEnabled: false,
      syncVideosEnabled: true,
    }),
    [{ mediaType: "video" }],
  );
});

test("message sync retains other supported media without overriding image/video settings", () => {
  assert.deepEqual(
    filterWhatsAppMediaItems(media, {
      syncMessagesEnabled: true,
      syncImagesEnabled: true,
      syncVideosEnabled: false,
    }),
    [{ mediaType: "image" }, { mediaType: "audio" }, { mediaType: "document" }],
  );
});

test("message sync treats media without a type as other supported media", () => {
  assert.deepEqual(
    filterWhatsAppMediaItems([{}], {
      syncMessagesEnabled: true,
      syncImagesEnabled: false,
      syncVideosEnabled: false,
    }),
    [{}],
  );
});

test("a message is included when message sync or a selected media type is enabled", () => {
  assert.equal(shouldSyncWhatsAppMessage(false, false, false, 0), false);
  assert.equal(shouldSyncWhatsAppMessage(true, true, false, 0), true);
  assert.equal(shouldSyncWhatsAppMessage(false, false, true, 1), true);
  assert.equal(shouldSyncWhatsAppMessage(true, false, true, 0), false);
  assert.equal(shouldSyncWhatsAppMessage(true, true, true, 0), true);
});
