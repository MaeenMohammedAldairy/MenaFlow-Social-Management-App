import assert from "node:assert/strict";
import test from "node:test";
import { postReadinessIssue } from "./post-readiness.ts";

const readyWhatsAppPost = {
  title: "عنوان",
  body: "نص المنشور",
  sourceType: "whatsapp",
  mediaUrls: ["media-one"],
  availableMediaIds: new Set(["media-one"]),
  sourceMediaComplete: true,
  expectedMediaCount: 1,
};

test("accepts a WhatsApp post with text and stored complete media", () => {
  assert.equal(postReadinessIssue(readyWhatsAppPost), null);
});

test("requires a WhatsApp body even when the post has a title", () => {
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    body: "  ",
  }), "POST_TEXT_REQUIRED");
});

test("requires at least one media item", () => {
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    mediaUrls: [],
  }), "POST_MEDIA_REQUIRED");
});

test("rejects media that is not available in the active workspace", () => {
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    availableMediaIds: new Set(),
  }), "POST_MEDIA_UNAVAILABLE");
});

test("rejects external URLs as WhatsApp source media", () => {
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    mediaUrls: ["https://example.test/image.jpg"],
    availableMediaIds: new Set(),
  }), "POST_MEDIA_UNAVAILABLE");
});

test("rejects incomplete source media and album counts", () => {
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    sourceMediaComplete: false,
  }), "POST_MEDIA_INCOMPLETE");
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    mediaUrls: ["media-one"],
    availableMediaIds: new Set(["media-one"]),
    expectedMediaCount: 2,
  }), "POST_MEDIA_INCOMPLETE");
});

test("allows media intentionally removed from a complete source album", () => {
  assert.equal(postReadinessIssue({
    ...readyWhatsAppPost,
    mediaUrls: ["media-one", "media-two"],
    availableMediaIds: new Set(["media-one", "media-two"]),
    expectedMediaCount: 3,
    removedSourceMediaIds: ["media-three"],
  }), null);
});

test("allows a manual post title to serve as its publishing text", () => {
  assert.equal(postReadinessIssue({
    title: "عنوان المنشور",
    body: "",
    sourceType: "manual",
    mediaUrls: ["https://example.test/image.jpg"],
    availableMediaIds: new Set(),
  }), null);
});

test("allows an authorized product media ID on a manual post", () => {
  const mediaId = "product-media-image-workspacehash-fileid-jpg";
  assert.equal(postReadinessIssue({
    title: "عنوان المنشور",
    body: "",
    sourceType: "manual",
    mediaUrls: [mediaId],
    availableMediaIds: new Set([mediaId]),
  }), null);
});