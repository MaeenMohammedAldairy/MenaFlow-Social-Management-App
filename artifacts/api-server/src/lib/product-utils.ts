import { createHash } from "node:crypto";

export function normalizedProductName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function workspaceMediaKey(workspaceId: string): string {
  return createHash("sha256")
    .update(workspaceId)
    .digest("hex")
    .slice(0, 16);
}

export type ProductMediaIdParts = {
  mediaType: "image" | "video";
  workspaceKey: string;
  fileId: string;
  extension: "jpg" | "png" | "webp" | "heic" | "heif" | "mp4" | "mov";
};

const productMediaIdPattern =
  /^product-media-(image|video)-([a-f0-9]{16})-([a-f0-9-]{36})-(jpg|png|webp|heic|heif|mp4|mov)$/;

const productMediaMimeTypes: Record<ProductMediaIdParts["extension"], string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

export function parseProductMediaId(value: string): ProductMediaIdParts | null {
  const match = productMediaIdPattern.exec(value);
  if (!match) return null;
  return {
    mediaType: match[1] as ProductMediaIdParts["mediaType"],
    workspaceKey: match[2]!,
    fileId: match[3]!,
    extension: match[4] as ProductMediaIdParts["extension"],
  };
}

export function productMediaIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(
      /^\/api\/social\/products\/public-media\/([^/]+)$/,
    );
    if (!match) return null;
    const mediaId = decodeURIComponent(match[1]!);
    return parseProductMediaId(mediaId) ? mediaId : null;
  } catch {
    return null;
  }
}

export function productMediaStoragePath(mediaId: string): string | null {
  const parsed = parseProductMediaId(mediaId);
  return parsed
    ? `product-media/${parsed.workspaceKey}/${parsed.fileId}.${parsed.extension}`
    : null;
}

export function productMediaInfo(mediaId: string, workspaceId: string) {
  const parsed = parseProductMediaId(mediaId);
  if (!parsed || parsed.workspaceKey !== workspaceMediaKey(workspaceId)) {
    return null;
  }
  return {
    ...parsed,
    mimeType: productMediaMimeTypes[parsed.extension],
    fileName: `${parsed.fileId}.${parsed.extension}`,
    storagePath: productMediaStoragePath(mediaId)!,
  };
}
