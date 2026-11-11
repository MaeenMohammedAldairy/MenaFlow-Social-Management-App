import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createMediaThumbnail,
  resolveWhatsAppMediaStorageRoot,
  storeMediaObject,
  thumbnailObjectPath,
} from "./whatsapp-media-storage.ts";
import { productMediaStoragePath, workspaceMediaKey } from "./product-utils.ts";

export const PRODUCT_MEDIA_TYPES = {
  "image/jpeg": { mediaType: "image", extension: "jpg" },
  "image/png": { mediaType: "image", extension: "png" },
  "image/webp": { mediaType: "image", extension: "webp" },
  "image/heic": { mediaType: "image", extension: "heic" },
  "image/heif": { mediaType: "image", extension: "heif" },
  "video/mp4": { mediaType: "video", extension: "mp4" },
  "video/quicktime": { mediaType: "video", extension: "mov" },
} as const;

const MAX_PRODUCT_MEDIA_BYTES = 20 * 1024 * 1024;

export async function storeProductMedia(
  workspaceId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ id: string; mediaType: "image" | "video" }> {
  const mediaConfig = Object.prototype.hasOwnProperty.call(
    PRODUCT_MEDIA_TYPES,
    mimeType,
  )
    ? PRODUCT_MEDIA_TYPES[mimeType as keyof typeof PRODUCT_MEDIA_TYPES]
    : null;
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0 ||
    buffer.length > MAX_PRODUCT_MEDIA_BYTES ||
    !mediaConfig
  ) {
    throw new Error("PRODUCT_MEDIA_TYPE_OR_SIZE_INVALID");
  }

  let thumbnail: Buffer | null = null;
  if (mediaConfig.mediaType === "image") {
    try {
      thumbnail = await createMediaThumbnail(buffer);
    } catch {
      throw new Error("PRODUCT_MEDIA_IMAGE_INVALID");
    }
  } else if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") {
    throw new Error("PRODUCT_MEDIA_VIDEO_INVALID");
  }

  const id = `product-media-${mediaConfig.mediaType}-${workspaceMediaKey(workspaceId)}-${randomUUID()}-${mediaConfig.extension}`;
  const objectPath = productMediaStoragePath(id);
  if (!objectPath) throw new Error("PRODUCT_MEDIA_ID_INVALID");
  const provider = await storeMediaObject(objectPath, buffer, mimeType);
  if (provider === "local") {
    const root = resolveWhatsAppMediaStorageRoot();
    const originalPath = path.resolve(root, objectPath);
    if (!originalPath.startsWith(`${root}${path.sep}`)) {
      throw new Error("INVALID_PRODUCT_MEDIA_PATH");
    }
    await mkdir(path.dirname(originalPath), { recursive: true });
    await writeFile(originalPath, buffer);
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

  return { id, mediaType: mediaConfig.mediaType };
}
