import { getMetaGraphVersion } from "./meta-graph-config.ts";
import {
  PRODUCT_MEDIA_TYPES,
  storeProductMedia,
} from "./product-media-storage.ts";

const MAX_META_MEDIA_BYTES = 20 * 1024 * 1024;
const META_MEDIA_TIMEOUT_MS = 30_000;
const MAX_META_MEDIA_REDIRECTS = 3;

const META_MEDIA_HOSTS = ["fbcdn.net", "cdninstagram.com", "fbsbx.com"];

export function isMetaMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      META_MEDIA_HOSTS.some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      )
    );
  } catch {
    return false;
  }
}

export async function fetchMetaPostImage(
  url: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!isMetaMediaUrl(url)) throw new Error("META_MEDIA_URL_INVALID");

  let currentUrl = url;
  let response: Response;
  for (let redirects = 0; ; redirects += 1) {
    response = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(META_MEDIA_TIMEOUT_MS),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    const redirectUrl = location
      ? new URL(location, currentUrl).toString()
      : "";
    await response.body?.cancel();
    if (
      redirects >= MAX_META_MEDIA_REDIRECTS ||
      !redirectUrl ||
      !isMetaMediaUrl(redirectUrl)
    ) {
      throw new Error("META_MEDIA_REDIRECT_INVALID");
    }
    currentUrl = redirectUrl;
  }
  if (!response.ok) throw new Error(`META_MEDIA_HTTP_${response.status}`);

  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !mimeType ||
    !Object.prototype.hasOwnProperty.call(PRODUCT_MEDIA_TYPES, mimeType)
  ) {
    throw new Error("META_MEDIA_TYPE_UNSUPPORTED");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_META_MEDIA_BYTES) {
    throw new Error("META_MEDIA_SIZE_EXCEEDED");
  }
  if (!response.body) throw new Error("META_MEDIA_BODY_MISSING");

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_META_MEDIA_BYTES) {
        await reader.cancel();
        throw new Error("META_MEDIA_SIZE_EXCEEDED");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error("META_MEDIA_BODY_EMPTY");

  return { buffer: Buffer.concat(chunks), mimeType };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function metaPostImageUrl(
  platform: "facebook" | "instagram",
  payload: unknown,
): string | null {
  const post = record(payload);
  if (!post) return null;
  if (platform === "facebook") {
    const directImage = stringValue(post.full_picture);
    if (directImage && isMetaMediaUrl(directImage)) return directImage;
    const attachments = record(post.attachments);
    const data = Array.isArray(attachments?.data) ? attachments.data : [];
    for (const attachmentValue of data) {
      const attachment = record(attachmentValue);
      const media = record(attachment?.media);
      const image = record(media?.image);
      const url = stringValue(image?.src);
      if (url && isMetaMediaUrl(url)) return url;
    }
    return null;
  }

  const mediaType = stringValue(post.media_type);
  const imageUrl =
    mediaType === "VIDEO"
      ? stringValue(post.thumbnail_url)
      : (stringValue(post.media_url) ?? stringValue(post.thumbnail_url));
  return imageUrl && isMetaMediaUrl(imageUrl) ? imageUrl : null;
}

export async function fetchMetaPostImageFromGraph(
  accessToken: string,
  platform: "facebook" | "instagram",
  postId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const graphUrl = new URL(
    `https://graph.facebook.com/${getMetaGraphVersion()}/${encodeURIComponent(postId)}`,
  );
  graphUrl.searchParams.set(
    "fields",
    platform === "facebook"
      ? "full_picture,attachments{media}"
      : "media_type,media_url,thumbnail_url",
  );
  const response = await fetch(graphUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`META_GRAPH_MEDIA_HTTP_${response.status}`);
  const payload: unknown = await response.json().catch(() => null);
  const imageUrl = metaPostImageUrl(platform, payload);
  if (!imageUrl) throw new Error("META_GRAPH_POST_IMAGE_UNAVAILABLE");
  return fetchMetaPostImage(imageUrl);
}

export async function storeMetaPostImage(
  workspaceId: string,
  url: string,
): Promise<string> {
  const { buffer, mimeType } = await fetchMetaPostImage(url);
  return (await storeProductMedia(workspaceId, buffer, mimeType)).id;
}
