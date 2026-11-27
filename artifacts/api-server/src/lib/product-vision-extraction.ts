/**
 * product-vision-extraction.ts
 *
 * The image half of product extraction: which messages are worth opening, which
 * stored rows may be sent, and how a phone photo becomes a byte string a model
 * accepts.
 *
 * There is deliberately no vision *call* here. Photos used to be read by a
 * second request whose answer was pasted onto the first one's, and the two
 * readings disagreed in ways the merchant had to untangle: a caption said one
 * price, a photo said another, and each call could only see its own half. Now
 * the group's text and its images go to `extractWhatsAppProductCandidates` as
 * one request, and the grounding contract is unchanged — a value still has to be
 * quoted from what the model reported as visible, whether that came from a
 * message body or from the text inside a photo.
 *
 * Vision stays opt-in (`PRODUCT_VISION_EXTRACTION_ENABLED`) because it spends AI
 * quota on messages that previously cost nothing, and a candidate that came from
 * an image is never auto-published: the caller forces a manual review, so the
 * first product read off a picture is always confirmed by a person.
 */

import path from "node:path";

import sharp from "sharp";

import {
  MAX_AI_IMAGE_BASE64_LENGTH,
  type AiImage,
} from "./ai-image-validation.ts";
import { logger } from "./logger.ts";

/** Images sent to the model per extraction. A product shot needs one or two. */
export const MAX_VISION_IMAGES = 3;

/** Source objects larger than this are skipped rather than decoded. */
export const MAX_VISION_SOURCE_BYTES = 12 * 1024 * 1024;

/** Longest edge after re-encoding; enough for label text, cheap to upload. */
export const VISION_IMAGE_EDGE = 1024;

/** Same decode ceiling the media storage layer uses (decompression bombs). */
const MAX_VISION_INPUT_PIXELS = 25_000_000;

/** A small PNG or WebP is sent as-is; everything else is re-encoded to JPEG. */
const PASSTHROUGH_MIME_TYPES = new Set(["image/png", "image/webp"]);
const PASSTHROUGH_MAX_BYTES = 1_500_000;

export type StoredVisionMediaRow = {
  id: string;
  /**
   * The message the row belongs to. Text and images of one bundle are now read
   * by the same call, so an image has to be attributable to the message it came
   * with — otherwise a fact read off a photo cannot name its photo.
   */
  messageId?: string;
  mediaType: string;
  mimeType: string | null;
  sizeBytes: number | null;
  downloadStatus: string;
  storageProvider: string;
  storageKey: string;
  storagePath: string;
  mediaIndex: number;
};

/**
 * Vision extraction is off unless the deployment asks for it: it spends AI
 * quota on messages that previously cost nothing.
 */
export function visionProductExtractionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env.PRODUCT_VISION_EXTRACTION_ENABLED?.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

/** Storage locator for a row, or null when the object cannot be read back. */
export function visionMediaStorageLocator(
  row: StoredVisionMediaRow,
): { provider: "supabase" | "local"; locator: string } | null {
  if (row.storageProvider === "supabase") {
    const key = row.storageKey?.trim();
    return key ? { provider: "supabase", locator: key } : null;
  }
  if (row.storageProvider === "local") {
    const localPath = row.storagePath?.trim();
    return localPath && path.isAbsolute(localPath)
      ? { provider: "local", locator: localPath }
      : null;
  }
  return null;
}

/**
 * Images worth sending: stored, image kind, readable locator, within the size
 * cap, in album order, capped at `MAX_VISION_IMAGES`.
 */
export function selectVisionMedia(
  rows: readonly StoredVisionMediaRow[],
): StoredVisionMediaRow[] {
  return rows
    .filter((row) => row.downloadStatus === "stored")
    .filter((row) => row.mediaType === "image")
    .filter((row) => visionMediaStorageLocator(row) !== null)
    .filter(
      (row) =>
        row.sizeBytes === null ||
        (row.sizeBytes > 0 && row.sizeBytes <= MAX_VISION_SOURCE_BYTES),
    )
    .sort((a, b) => a.mediaIndex - b.mediaIndex || a.id.localeCompare(b.id))
    .slice(0, MAX_VISION_IMAGES);
}

/**
 * Reads one selected object. `readStoredObject` is injected by the caller
 * (Supabase Storage in production, the local disk in development) so this
 * module stays free of database and storage imports and remains unit testable.
 */
export async function readStoredVisionMedia(
  row: StoredVisionMediaRow,
  readStoredObject: (locator: { provider: "supabase" | "local"; locator: string }) => Promise<Buffer>,
): Promise<Buffer> {
  const locator = visionMediaStorageLocator(row);
  if (!locator) throw new Error("PRODUCT_VISION_MEDIA_UNAVAILABLE");
  return readStoredObject(locator);
}

/**
 * Normalizes an image into something both providers accept: small PNG/WebP pass
 * through, everything else (HEIC, GIF, huge JPEGs, phone rotations) becomes a
 * bounded JPEG.
 */
export async function prepareVisionImage(
  buffer: Buffer,
  mimeType: string | null,
): Promise<AiImage> {
  const normalizedMime = mimeType?.trim().toLowerCase() ?? "";
  if (
    PASSTHROUGH_MIME_TYPES.has(normalizedMime) &&
    buffer.length <= PASSTHROUGH_MAX_BYTES
  ) {
    const dataBase64 = buffer.toString("base64");
    if (dataBase64.length > MAX_AI_IMAGE_BASE64_LENGTH) {
      throw new Error("AI_IMAGE_TOO_LARGE");
    }
    return { mimeType: normalizedMime, dataBase64 };
  }

  const jpeg = await sharp(buffer, {
    failOn: "error",
    limitInputPixels: MAX_VISION_INPUT_PIXELS,
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: VISION_IMAGE_EDGE,
      height: VISION_IMAGE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer();
  const dataBase64 = jpeg.toString("base64");
  if (dataBase64.length > MAX_AI_IMAGE_BASE64_LENGTH) {
    throw new Error("AI_IMAGE_TOO_LARGE");
  }
  return { mimeType: "image/jpeg", dataBase64 };
}
