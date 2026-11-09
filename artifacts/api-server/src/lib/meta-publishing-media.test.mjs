import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { selectFacebookPhotoMedia } from "./meta-publishing-media.ts";
import { createMediaJpeg } from "./whatsapp-media-storage.ts";

test("Instagram image conversion produces an oriented JPEG", async () => {
  const png = await sharp({
    create: {
      width: 2,
      height: 3,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  }).png().toBuffer();

  const jpeg = await createMediaJpeg(png);
  const metadata = await sharp(jpeg).metadata();

  assert.equal(metadata.format, "jpeg");
  assert.deepEqual([metadata.width, metadata.height], [2, 3]);
});

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
