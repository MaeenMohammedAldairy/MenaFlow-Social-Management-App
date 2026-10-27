import assert from "node:assert/strict";
import test from "node:test";
import { selectFacebookPhotoMedia } from "./meta-publishing-media.ts";

test("Facebook album selection excludes video and unsupported image formats", () => {
  const media = [
    { id: "one", mediaType: "image", mimeType: "image/jpeg" },
    { id: "two", mediaType: "video", mimeType: "video/mp4" },
    { id: "three", mediaType: "image", mimeType: "image/webp" },
    { id: "four", mediaType: "image", mimeType: "image/png" },
  ];

  const selection = selectFacebookPhotoMedia(media);
  assert.deepEqual(selection.photos.map((item) => item.id), ["one", "four"]);
  assert.equal(selection.omittedCount, 2);
});

test("Facebook albums are capped at ten supported photos and report omissions", () => {
  const media = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    mediaType: "image",
    mimeType: "image/jpeg",
  }));

  const selection = selectFacebookPhotoMedia(media);
  assert.equal(selection.photos.length, 10);
  assert.equal(selection.omittedCount, 2);
});
