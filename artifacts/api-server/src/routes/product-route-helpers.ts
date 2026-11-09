import { and, eq, inArray } from "drizzle-orm";

import { db, menaWhatsAppMessageMedia, products } from "@workspace/db";

import { PublicMediaUrlError } from "../lib/meta-media-url";
import {
  signedProductMediaUrl,
  signedWhatsAppMediaUrl,
} from "../lib/meta-publishing";

import { productMediaInfo } from "../lib/product-utils.ts";

export function mediaUrls(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string")
    : [];
}

export function mediaRequestOrigin(req: {
  protocol: string;
  get(name: string): string | undefined;
}): string | undefined {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : undefined;
}

export type ProductMediaPreview = {
  id: string;
  url: string;
  mediaType: string;
};

export const PRODUCT_MEDIA_TYPES = {
  "image/jpeg": { mediaType: "image", extension: "jpg" },
  "image/png": { mediaType: "image", extension: "png" },
  "image/webp": { mediaType: "image", extension: "webp" },
  "image/heic": { mediaType: "image", extension: "heic" },
  "image/heif": { mediaType: "image", extension: "heif" },
  "video/mp4": { mediaType: "video", extension: "mp4" },
  "video/quicktime": { mediaType: "video", extension: "mov" },
} as const;

export function productMediaUrl(
  mediaId: string,
  mediaType: string,
  requestOrigin?: string,
): string | null {
  try {
    return signedWhatsAppMediaUrl(
      mediaId,
      true,
      mediaType === "image" ? "thumbnail" : "original",
      requestOrigin,
    );
  } catch (error) {
    if (error instanceof PublicMediaUrlError) return null;
    throw error;
  }
}

export function externalMediaPreview(url: string): ProductMediaPreview | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const mediaType = /\.(?:mp4|mov|webm)$/i.test(parsed.pathname)
      ? "video"
      : "image";
    return { id: url, url, mediaType };
  } catch {
    return null;
  }
}

export async function productMediaPreviews(
  workspaceId: string,
  mediaIds: string[],
  requestOrigin?: string,
): Promise<ProductMediaPreview[]> {
  const productMediaPreviews = mediaIds.flatMap((id) => {
    const parsed = productMediaInfo(id, workspaceId);
    if (!parsed) return [];
    const url = signedProductMediaUrl(
      id,
      parsed.mediaType === "image" ? "thumbnail" : "original",
      requestOrigin,
    );
    return url ? [{ id, url, mediaType: parsed.mediaType }] : [];
  });
  const externalPreviews = mediaIds.flatMap((id) => {
    if (!/^https?:\/\//i.test(id)) return [];
    const preview = externalMediaPreview(id);
    return preview ? [preview] : [];
  });
  const storedIds = mediaIds.filter((id) => !/^https?:\/\//i.test(id));
  const storedMedia = storedIds.length
    ? await db
        .select({
          id: menaWhatsAppMessageMedia.id,
          mediaType: menaWhatsAppMessageMedia.mediaType,
        })
        .from(menaWhatsAppMessageMedia)
        .where(
          and(
            eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
            inArray(menaWhatsAppMessageMedia.id, storedIds),
          ),
        )
    : [];
  const storedPreviews = storedMedia.flatMap((media) => {
    const url = productMediaUrl(media.id, media.mediaType, requestOrigin);
    return url ? [{ id: media.id, url, mediaType: media.mediaType }] : [];
  });
  const previewById = new Map(
    [...externalPreviews, ...storedPreviews, ...productMediaPreviews].map(
      (preview) => [preview.id, preview],
    ),
  );
  return mediaIds.flatMap((id) => {
    const preview = previewById.get(id);
    return preview ? [preview] : [];
  });
}

export async function catalogProductResponse(
  product: typeof products.$inferSelect,
  workspaceId: string,
  postIds: string[] = [],
  requestOrigin?: string,
) {
  const productMediaUrls = [...new Set(mediaUrls(product.mediaUrls))].slice(
    0,
    20,
  );
  return {
    ...product,
    mediaUrls: productMediaUrls,
    mediaPreviews: await productMediaPreviews(
      workspaceId,
      productMediaUrls,
      requestOrigin,
    ),
    postIds,
  };
}
