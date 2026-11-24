/**
 * ai-image-validation.ts
 *
 * The inline-image contract shared by the dispatch layer and the vision
 * callers. It lives in its own module so a caller can use the limits without
 * importing `ai-provider.ts` as a value, which the lint guard forbids in favour
 * of the metered entry point.
 */

/**
 * An inline image for the rare vision-enabled callers. Images travel as base64
 * so no storage object ever has to be made public for a model to see it.
 * Text stays the default: every other caller keeps the text-only guarantee.
 */
export type AiImage = {
  mimeType: string;
  dataBase64: string;
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Cap on inline images per call; extraction needs a product shot, not an album. */
export const MAX_AI_IMAGES_PER_CALL = 4;

/** Cap on the base64 payload per image (≈6 MB decoded). */
export const MAX_AI_IMAGE_BASE64_LENGTH = 8_000_000;

export function validateAiImages(
  images: readonly AiImage[] | undefined,
): AiImage[] {
  if (!images?.length) return [];
  if (images.length > MAX_AI_IMAGES_PER_CALL) {
    throw new Error("AI_TOO_MANY_IMAGES");
  }
  return images.map((image) => {
    if (
      !image ||
      typeof image.mimeType !== "string" ||
      typeof image.dataBase64 !== "string"
    ) {
      throw new Error("AI_IMAGE_REQUIRED");
    }
    const mimeType = image.mimeType.trim().toLowerCase();
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error("AI_IMAGE_MIME_UNSUPPORTED");
    }
    const dataBase64 = image.dataBase64.replace(/\s+/g, "");
    if (!dataBase64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
      throw new Error("AI_IMAGE_DATA_INVALID");
    }
    if (dataBase64.length > MAX_AI_IMAGE_BASE64_LENGTH) {
      throw new Error("AI_IMAGE_TOO_LARGE");
    }
    return { mimeType, dataBase64 };
  });
}
