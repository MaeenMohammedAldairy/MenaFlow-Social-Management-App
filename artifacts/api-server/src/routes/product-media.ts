import { readFile } from "node:fs/promises";
import path from "node:path";

import express, { Router } from "express";

import { metaString } from "../lib/meta-inbox-utils";

import { verifySignedMediaRequest } from "../lib/meta-publishing";
import {
  createMediaJpeg,
  readMediaObject,
  resolveWhatsAppMediaStorageRoot,
  streamMediaObject,
  thumbnailObjectPath,
} from "../lib/whatsapp-media-storage";
import { requestOwnerId } from "../lib/owner-access";
import {
  PRODUCT_MEDIA_TYPES,
  storeProductMedia,
} from "../lib/product-media-storage";

import {
  parseProductMediaId,
  productMediaStoragePath,
} from "../lib/product-utils.ts";

import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();
import {
  mediaRequestOrigin,
  productMediaPreviews,
} from "./product-route-helpers";

router.get("/social/products/public-media/:mediaId", async (req, res) => {
  const mediaId = metaString(req.params.mediaId);
  const parsed = mediaId ? parseProductMediaId(mediaId) : null;
  const expires =
    typeof req.query.expires === "string" ? req.query.expires : "";
  const signature =
    typeof req.query.signature === "string" ? req.query.signature : "";
  const variant =
    req.query.variant === "thumbnail" || req.query.variant === "instagram-jpeg"
      ? req.query.variant
      : "original";
  if (
    !mediaId ||
    !parsed ||
    !verifySignedMediaRequest(mediaId, expires, signature, variant) ||
    (variant !== "original" && parsed.mediaType !== "image")
  ) {
    res.status(403).json({ error: "رابط الوسائط غير صالح أو منتهي الصلاحية." });
    return;
  }

  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  const relativePath = productMediaStoragePath(mediaId);
  if (!relativePath) {
    res.status(404).json({ error: "ملف الوسائط غير متاح." });
    return;
  }
  const storagePath =
    variant === "thumbnail" ? thumbnailObjectPath(relativePath) : relativePath;
  const mimeType =
    variant !== "original"
      ? variant === "thumbnail"
        ? "image/webp"
        : "image/jpeg"
      : (Object.entries(PRODUCT_MEDIA_TYPES).find(
          ([, value]) => value.extension === parsed.extension,
        )?.[0] ?? "application/octet-stream");

  if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (variant === "instagram-jpeg") {
      const jpeg = await createMediaJpeg(await readMediaObject(storagePath));
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(jpeg);
      return;
    }
    const storedObject = await streamMediaObject(storagePath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    if (storedObject.contentLength) {
      res.setHeader("Content-Length", storedObject.contentLength);
    }
    storedObject.stream.pipe(res);
    return;
  }

  const root = resolveWhatsAppMediaStorageRoot();
  const resolvedPath = path.resolve(root, storagePath);
  if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("INVALID_PRODUCT_MEDIA_PATH");
  }
  try {
    const source = await readFile(resolvedPath);
    const file =
      variant === "instagram-jpeg" ? await createMediaJpeg(source) : source;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      res.status(404).json({ error: "ملف الوسائط غير متاح." });
      return;
    }
    throw error;
  }
});

router.post(
  "/social/products/media",
  requireWorkspace,
  express.raw({ type: ["image/*", "video/*"], limit: "20mb" }),
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const mimeType = req.get("content-type")?.split(";", 1)[0].toLowerCase();
    if (!Buffer.isBuffer(req.body) || !mimeType) {
      res.status(400).json({ error: "نوع ملف الوسائط غير مدعوم." });
      return;
    }

    let storedMedia: Awaited<ReturnType<typeof storeProductMedia>>;
    try {
      storedMedia = await storeProductMedia(workspaceId, req.body, mimeType);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "PRODUCT_MEDIA_IMAGE_INVALID"
      ) {
        res.status(400).json({ error: "تعذّر قراءة ملف الصورة." });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "PRODUCT_MEDIA_VIDEO_INVALID"
      ) {
        res.status(400).json({ error: "ملف الفيديو غير صالح." });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "PRODUCT_MEDIA_TYPE_OR_SIZE_INVALID"
      ) {
        res.status(400).json({ error: "نوع ملف الوسائط غير مدعوم." });
        return;
      }
      throw error;
    }

    res.status(201).json({
      media: {
        id: storedMedia.id,
        mediaType: storedMedia.mediaType,
        mediaPreview:
          (
            await productMediaPreviews(
              workspaceId,
              [storedMedia.id],
              mediaRequestOrigin(req),
            )
          )[0] ?? null,
      },
    });
  },
);

export default router;
