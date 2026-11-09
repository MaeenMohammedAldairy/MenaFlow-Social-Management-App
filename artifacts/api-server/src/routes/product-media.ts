import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import express, { Router } from "express";

import { metaString } from "../lib/meta-inbox-utils";

import { verifySignedMediaRequest } from "../lib/meta-publishing";
import {
  createMediaJpeg,
  createMediaThumbnail,
  readMediaObject,
  resolveWhatsAppMediaStorageRoot,
  storeMediaObject,
  streamMediaObject,
  thumbnailObjectPath,
} from "../lib/whatsapp-media-storage";
import { requestOwnerId } from "../lib/owner-access";

import {
  parseProductMediaId,
  productMediaStoragePath,
  workspaceMediaKey,
} from "../lib/product-utils.ts";

import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();
import {
  mediaRequestOrigin,
  PRODUCT_MEDIA_TYPES,
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
    const mediaConfig =
      mimeType && mimeType in PRODUCT_MEDIA_TYPES
        ? PRODUCT_MEDIA_TYPES[mimeType as keyof typeof PRODUCT_MEDIA_TYPES]
        : null;
    if (
      !Buffer.isBuffer(req.body) ||
      !mimeType ||
      !mediaConfig ||
      req.body.length === 0
    ) {
      res.status(400).json({ error: "نوع ملف الوسائط غير مدعوم." });
      return;
    }

    let thumbnail: Buffer | null = null;
    if (mediaConfig.mediaType === "image") {
      try {
        thumbnail = await createMediaThumbnail(req.body);
      } catch {
        res.status(400).json({ error: "تعذّر قراءة ملف الصورة." });
        return;
      }
    } else if (
      req.body.length < 12 ||
      req.body.toString("ascii", 4, 8) !== "ftyp"
    ) {
      res.status(400).json({ error: "ملف الفيديو غير صالح." });
      return;
    }

    const workspaceKey = workspaceMediaKey(workspaceId);
    const fileId = randomUUID();
    const mediaId = `product-media-${mediaConfig.mediaType}-${workspaceKey}-${fileId}-${mediaConfig.extension}`;
    const objectPath = productMediaStoragePath(mediaId);
    if (!objectPath) throw new Error("PRODUCT_MEDIA_ID_INVALID");
    const provider = await storeMediaObject(objectPath, req.body, mimeType);
    if (provider === "local") {
      const root = resolveWhatsAppMediaStorageRoot();
      const originalPath = path.resolve(root, objectPath);
      if (!originalPath.startsWith(`${root}${path.sep}`)) {
        throw new Error("INVALID_PRODUCT_MEDIA_PATH");
      }
      await mkdir(path.dirname(originalPath), { recursive: true });
      await writeFile(originalPath, req.body);
    }
    if (thumbnail) {
      const thumbnailPath = thumbnailObjectPath(objectPath);
      const thumbnailProvider = await storeMediaObject(
        thumbnailPath,
        thumbnail,
        "image/webp",
      );
      if (thumbnailProvider === "local") {
        const root = resolveWhatsAppMediaStorageRoot();
        const resolvedPath = path.resolve(root, thumbnailPath);
        if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
          throw new Error("INVALID_PRODUCT_MEDIA_PATH");
        }
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, thumbnail);
      }
    }

    res.status(201).json({
      media: {
        id: mediaId,
        mediaType: mediaConfig.mediaType,
        mediaPreview:
          (
            await productMediaPreviews(
              workspaceId,
              [mediaId],
              mediaRequestOrigin(req),
            )
          )[0] ?? null,
      },
    });
  },
);

export default router;
