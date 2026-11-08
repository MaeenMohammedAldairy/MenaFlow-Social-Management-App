import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaPostActivityEvents,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  posts,
  products,
} from "@workspace/db";
import {
  classifyFacebookVerification,
  decideUncertainFacebookRetry,
  type FacebookRetryVerification,
} from "./publish-retry";
import {
  PublicMediaUrlError,
  resolvePublicMediaBaseUrl,
} from "./meta-media-url";
import {
  metaTokenEncryptionKey,
} from "./meta-token-crypto";
import { metaConnectionAccessToken } from "./meta-connection-token.ts";
import { getMetaGraphVersion } from "./meta-graph-config";
import { logger } from "./logger";
import { makePublishActivityEvent } from "./post-activity";
import { assertPostWorkspace } from "./workspace-record-access";
import { selectFacebookPhotoMedia } from "./meta-publishing-media";
import { readMediaObject, resolveWhatsAppMediaStorageRoot } from "./whatsapp-media-storage";
import { productMediaInfo } from "./product-utils.ts";
import { isVerifiedActiveProduct } from "./product-publishing-logic.ts";

const GRAPH_VERSION = getMetaGraphVersion();
const INSTAGRAM_REQUEST_TIMEOUT_MS = 120_000;
const INSTAGRAM_PROCESSING_TIMEOUT_MS = 120_000;
const MEDIA_ROOT = resolveWhatsAppMediaStorageRoot();
type ChannelResult = {
  status: "published" | "failed" | "unknown" | "publishing" | "skipped";
  postId?: string;
  url?: string | null;
  reason?: string;
  attemptedAt?: string;
};

class MetaApiError extends Error {
  constructor(
    message: string,
    readonly details: {
      status: number;
      code?: number;
      subcode?: number;
      type?: string;
    },
  ) {
    super(message);
  }
}

class MetaNetworkError extends Error {
  readonly causeCode?: string;
  readonly causeName: string;

  constructor(readonly stage: string, cause: unknown) {
    super("META_GRAPH_NETWORK_FAILED");
    this.name = "MetaNetworkError";
    this.causeName = cause instanceof Error ? cause.name : "UnknownError";
    const nestedCause = cause && typeof cause === "object" && "cause" in cause
      ? cause.cause
      : cause;
    if (
      nestedCause &&
      typeof nestedCause === "object" &&
      "code" in nestedCause &&
      (typeof nestedCause.code === "string" || typeof nestedCause.code === "number")
    ) {
      this.causeCode = String(nestedCause.code);
    }
  }
}

export function signedWhatsAppMediaUrl(
  mediaId: string,
  allowLocalHttp = false,
  variant: "original" | "thumbnail" = "original",
  requestOrigin?: string,
): string {
  const development = process.env.NODE_ENV === "development";
  const publicBase = resolvePublicMediaBaseUrl({
    configuredBase: process.env.MENA_PUBLIC_MEDIA_BASE_URL,
    allowDeploymentFallbacks: development,
    ...(development && allowLocalHttp && requestOrigin
      ? { requestOrigin }
      : {}),
    ...(development
      ? { expoPublicDomain: process.env.EXPO_PUBLIC_DOMAIN }
      : {}),
  });
  const localBase = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const base = publicBase ||
    (allowLocalHttp && development && localBase
      ? `${/^https?:\/\//i.test(localBase) ? "" : "http://"}${localBase}`
      : "");
  if (!base) throw new PublicMediaUrlError("PUBLIC_MEDIA_BASE_URL_REQUIRED");
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = createHmac("sha256", metaTokenEncryptionKey())
    .update(`${mediaId}:${expires}:${variant}`)
    .digest("hex");
  const url = new URL(`/api/social/whatsapp/public-media/${encodeURIComponent(mediaId)}`, base);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  if (variant === "thumbnail") url.searchParams.set("variant", variant);
  if (url.protocol !== "https:") {
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (!allowLocalHttp || process.env.NODE_ENV !== "development" || !isLocalHost) {
      throw new PublicMediaUrlError("PUBLIC_MEDIA_URL_MUST_USE_HTTPS");
    }
  }
  return url.toString();
}

export function signedProductMediaUrl(
  mediaId: string,
  variant: "original" | "thumbnail",
  requestOrigin?: string,
): string | null {
  try {
    const url = new URL(
      signedWhatsAppMediaUrl(mediaId, true, variant, requestOrigin),
    );
    url.pathname = `/api/social/products/public-media/${encodeURIComponent(mediaId)}`;
    return url.toString();
  } catch (error) {
    if (error instanceof PublicMediaUrlError) return null;
    throw error;
  }
}

export function verifySignedMediaRequest(
  mediaId: string,
  expiresValue: string,
  signature: string,
  variant: "original" | "thumbnail" = "original",
): boolean {
  const expires = Number(expiresValue);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  const supplied = Buffer.from(signature, "hex");
  const signedPayloads = variant === "original"
    ? [`${mediaId}:${expires}:original`, `${mediaId}:${expires}`]
    : [`${mediaId}:${expires}:${variant}`];
  return signedPayloads.some((payload) => {
    const expected = createHmac("sha256", metaTokenEncryptionKey())
      .update(payload)
      .digest();
    return supplied.length === expected.length && timingSafeEqual(expected, supplied);
  });
}

async function graphRequest(
  endpoint: string,
  accessToken: string,
  form: Record<string, string | number | boolean | undefined> = {},
  method: "GET" | "POST" = "POST",
  timeoutMs = 30_000,
  retryNetworkError = false,
): Promise<Record<string, unknown>> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`);
  const params = new URLSearchParams();
  if (method === "POST") params.set("access_token", accessToken);
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const performFetch = () => fetch(
    method === "GET" ? `${url}?${params}` : url.toString(),
    {
      method,
      headers: method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : { Authorization: `Bearer ${accessToken}` },
      body: method === "POST" ? params : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  const retryCount = method === "GET" || retryNetworkError ? 2 : 0;
  let response: Response | undefined;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      response = await performFetch();
      break;
    } catch (error) {
      if (attempt === retryCount) {
        const stage = endpoint.endsWith("/media_publish")
          ? "media_publish"
          : endpoint.endsWith("/media")
            ? "media_creation"
            : form.fields === "status_code,status"
              ? "container_status"
              : endpoint.includes("/")
                ? "container_status"
                : "post_lookup";
        throw new MetaNetworkError(stage, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (!response) throw new Error("META_GRAPH_RESPONSE_MISSING");
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : {};
    const message = typeof error.message === "string" ? error.message : `META_HTTP_${response.status}`;
    throw new MetaApiError(message, {
      status: response.status,
      ...(typeof error.code === "number" ? { code: error.code } : {}),
      ...(typeof error.error_subcode === "number" ? { subcode: error.error_subcode } : {}),
      ...(typeof error.type === "string" ? { type: error.type } : {}),
    });
  }
  return payload;
}

async function graphUpload(
  endpoint: string,
  accessToken: string,
  fields: Record<string, string>,
  media: { buffer: Buffer; mimeType: string; fileName: string },
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.set("access_token", accessToken);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const fileBytes = new ArrayBuffer(media.buffer.byteLength);
  new Uint8Array(fileBytes).set(media.buffer);
  form.set("source", new Blob([fileBytes], { type: media.mimeType }), media.fileName);
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${endpoint}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object"
      ? payload.error as Record<string, unknown>
      : {};
    const message = typeof error.message === "string" ? error.message : `META_HTTP_${response.status}`;
    throw new MetaApiError(message, {
      status: response.status,
      ...(typeof error.code === "number" ? { code: error.code } : {}),
      ...(typeof error.error_subcode === "number" ? { subcode: error.error_subcode } : {}),
      ...(typeof error.type === "string" ? { type: error.type } : {}),
    });
  }
  return payload;
}

async function safeLocalMedia(row: typeof posts.$inferSelect) {
  if (!row.workspaceId) throw new Error("WORKSPACE_CONTEXT_MISSING");
  const isProductPost = row.sourceType === "product";
  const rowMediaIds = Array.isArray(row.mediaUrls) ? row.mediaUrls : [];
  const hasProductMediaReference = rowMediaIds.some((id) =>
    id.startsWith("product-media-"),
  );
  if (
    row.sourceType !== "whatsapp" &&
    !isProductPost &&
    !hasProductMediaReference
  ) return [];
  let mediaIds = rowMediaIds;
  if (isProductPost) {
    const metadata = row.metadata && typeof row.metadata === "object"
      ? row.metadata
      : {};
    const productId = typeof metadata.productId === "string"
      ? metadata.productId
      : "";
    const [product] = productId
      ? await db
          .select({
            mediaUrls: products.mediaUrls,
            status: products.status,
            verifiedAt: products.verifiedAt,
          })
          .from(products)
          .where(and(
            eq(products.id, productId),
            eq(products.workspaceId, row.workspaceId),
          ))
          .limit(1)
      : [];
    if (!product) throw new Error("PRODUCT_POST_SOURCE_UNAVAILABLE");
    if (!isVerifiedActiveProduct(product)) {
      throw new Error("PRODUCT_NOT_AVAILABLE");
    }
    mediaIds = Array.isArray(product.mediaUrls)
      ? product.mediaUrls.filter((id): id is string => typeof id === "string")
      : [];
  }
  const whatsAppMedia = mediaIds.length > 0
    ? await db
        .select({ media: menaWhatsAppMessageMedia })
        .from(menaWhatsAppMessageMedia)
        .innerJoin(
          menaWhatsAppMessages,
          and(
            eq(menaWhatsAppMessages.id, menaWhatsAppMessageMedia.messageId),
            eq(menaWhatsAppMessages.workspaceId, row.workspaceId),
            ...(isProductPost
              ? []
              : [
                  eq(menaWhatsAppMessages.ownerId, menaWhatsAppMessageMedia.ownerId),
                  eq(menaWhatsAppMessages.instanceName, menaWhatsAppMessageMedia.instanceName),
                  or(
                    eq(menaWhatsAppMessages.groupId, menaWhatsAppMessageMedia.groupId),
                    and(
                      isNull(menaWhatsAppMessages.groupId),
                      isNull(menaWhatsAppMessageMedia.groupId),
                      eq(menaWhatsAppMessages.groupJid, menaWhatsAppMessageMedia.groupJid),
                    ),
                  ),
                ]),
          ),
        )
        .where(and(
          eq(menaWhatsAppMessageMedia.workspaceId, row.workspaceId),
          inArray(menaWhatsAppMessageMedia.id, mediaIds),
          eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
        ))
        .then((rows) => rows.map(({ media: item }) => item))
    : !isProductPost && row.sourceMessageId
      ? await db
          .select({ media: menaWhatsAppMessageMedia })
          .from(menaWhatsAppMessageMedia)
          .innerJoin(
            menaWhatsAppMessages,
            and(
              eq(menaWhatsAppMessages.id, menaWhatsAppMessageMedia.messageId),
              eq(menaWhatsAppMessages.workspaceId, row.workspaceId),
              eq(menaWhatsAppMessages.ownerId, menaWhatsAppMessageMedia.ownerId),
              eq(menaWhatsAppMessages.instanceName, menaWhatsAppMessageMedia.instanceName),
              or(
                eq(menaWhatsAppMessages.groupId, menaWhatsAppMessageMedia.groupId),
                and(
                  isNull(menaWhatsAppMessages.groupId),
                  isNull(menaWhatsAppMessageMedia.groupId),
                  eq(menaWhatsAppMessages.groupJid, menaWhatsAppMessageMedia.groupJid),
                ),
              ),
            ),
          )
          .where(and(
            eq(menaWhatsAppMessageMedia.workspaceId, row.workspaceId),
            eq(menaWhatsAppMessageMedia.messageId, row.sourceMessageId),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
          ))
          .then((rows) => rows.map(({ media: item }) => item))
      : [];
  const productMediaIds = mediaIds.filter((id) =>
    id.startsWith("product-media-"),
  );
  const productMedia = [];
  for (const id of productMediaIds) {
    const info = productMediaInfo(id, row.workspaceId);
    if (!info) throw new Error("PRODUCT_MEDIA_UNAVAILABLE");
    const resolved = path.resolve(MEDIA_ROOT, info.storagePath);
    if (!resolved.startsWith(`${MEDIA_ROOT}${path.sep}`)) {
      throw new Error("INVALID_PRODUCT_MEDIA_PATH");
    }
    const buffer = process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY
      ? await readMediaObject(info.storagePath)
      : await readFile(resolved);
    productMedia.push({
      id,
      ...info,
      buffer,
      mediaIndex: mediaIds.indexOf(id),
      storageProvider:
        process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY
          ? "supabase" as const
          : "local" as const,
    });
  }
  const orderedMedia = [...whatsAppMedia, ...productMedia]
    .sort((left, right) => mediaIds.indexOf(left.id) - mediaIds.indexOf(right.id));
  if (
    mediaIds.length > 0 &&
    (orderedMedia.length !== mediaIds.length ||
      mediaIds.some((id) => /^https?:\/\//i.test(id)))
  ) {
    throw new Error("PRODUCT_MEDIA_UNAVAILABLE");
  }
  const result = [];
  for (const item of orderedMedia) {
    if (item.storageProvider === "supabase") {
      result.push({ ...item, buffer: await readMediaObject(item.storagePath) });
      continue;
    }
    const resolved = path.resolve(item.storagePath);
    if (!resolved.startsWith(`${MEDIA_ROOT}${path.sep}`)) throw new Error("INVALID_MEDIA_STORAGE_PATH");
    const fileStat = await stat(resolved);
    if (!fileStat.isFile() || fileStat.size === 0) throw new Error("MEDIA_FILE_MISSING");
    result.push({ ...item, buffer: await readFile(resolved) });
  }
  return result;
}

async function getPermalink(postId: string, accessToken: string): Promise<string | null> {
  try {
    const result = await graphRequest(postId, accessToken, { fields: "permalink_url" }, "GET");
    return typeof result.permalink_url === "string" ? result.permalink_url : null;
  } catch {
    return null;
  }
}

async function verifyFacebookPost(
  pageId: string,
  accessToken: string,
  post: typeof posts.$inferSelect,
  attemptedAt?: string,
): Promise<FacebookRetryVerification<ChannelResult>> {
  const message = (post.body || post.title).trim();
  const fallbackCreatedAt = post.createdAt instanceof Date
    ? post.createdAt
    : new Date(post.createdAt);
  const attemptDate = attemptedAt ? new Date(attemptedAt) : fallbackCreatedAt;
  if (!Number.isFinite(attemptDate.getTime())) return { status: "unavailable" };
  const since = Math.max(0, Math.floor(attemptDate.getTime() / 1000) - 60);
  let after: string | undefined;

  const errors: Array<Record<string, unknown>> = [];
  let completedEdges = 0;
  for (const edge of ["published_posts", "feed"]) {
    after = undefined;
    try {
      for (let page = 0; page < 5; page += 1) {
        const feed = await graphRequest(`${pageId}/${edge}`, accessToken, {
          fields: "id,message,created_time,permalink_url",
          limit: 100,
          since,
          after,
        }, "GET");
        if (!Array.isArray(feed.data)) {
          errors.push({ edge, errorMessage: "META_RESPONSE_MISSING_FEED_DATA" });
          break;
        }

        for (const item of feed.data) {
          if (!item || typeof item !== "object") continue;
          const candidate = item as Record<string, unknown>;
          if (candidate.message !== message || typeof candidate.id !== "string") continue;
          const permalink = typeof candidate.permalink_url === "string"
            ? candidate.permalink_url
            : null;
          return {
            status: "found",
            result: {
              status: "published",
              postId: candidate.id,
              url: permalink,
            },
          };
        }

        const paging = feed.paging && typeof feed.paging === "object"
          ? feed.paging as Record<string, unknown>
          : {};
        const cursors = paging.cursors && typeof paging.cursors === "object"
          ? paging.cursors as Record<string, unknown>
          : {};
        after = typeof cursors.after === "string" ? cursors.after : undefined;
        if (!after) {
          completedEdges += 1;
          break;
        }
      }
    } catch (error) {
      const metaError = error instanceof MetaApiError ? error.details : undefined;
      errors.push({
        edge,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        ...(metaError ?? {}),
      });
    }
  }

  const verification = classifyFacebookVerification<ChannelResult>({
    completedEdges,
    requiredEdges: 2,
    errors: errors.map((error) => ({
      code: typeof error.code === "number" ? error.code : undefined,
    })),
  });
  if (verification.status === "unavailable") {
    logger.warn({
      errors,
      completedEdges,
      requiredEdges: 2,
      reason: verification.reason,
    }, "Could not verify uncertain Facebook publish result");
  }
  return verification;
}

async function publishFacebook(
  pageId: string,
  accessToken: string,
  post: typeof posts.$inferSelect,
  media: Awaited<ReturnType<typeof safeLocalMedia>>,
): Promise<ChannelResult> {
  const message = (post.body || post.title).trim();
  const { photos: facebookPhotos, omittedCount: omittedMediaCount } =
    selectFacebookPhotoMedia(media);
  const omissionWarning = omittedMediaCount > 0
    ? `FACEBOOK_UNSUPPORTED_MEDIA_OMITTED:${omittedMediaCount}`
    : undefined;
  let result: Record<string, unknown>;
  if (facebookPhotos.length > 1) {
    const attachments: Record<string, string>[] = [];
    for (const item of facebookPhotos) {
      const uploaded = await graphUpload(`${pageId}/photos`, accessToken, { published: "false" }, {
        buffer: item.buffer,
        mimeType: item.mimeType || "image/jpeg",
        fileName: item.fileName || "media",
      });
      const mediaId = typeof uploaded.id === "string" ? uploaded.id : null;
      if (!mediaId) return { status: "unknown", reason: "META_RESPONSE_MISSING_ALBUM_PHOTO_ID" };
      attachments.push({ media_fbid: mediaId });
    }
    result = await graphRequest(`${pageId}/feed`, accessToken, {
      message,
      ...Object.fromEntries(attachments.map((item, index) => [
        `attached_media[${index}]`,
        JSON.stringify(item),
      ])),
    });
  } else if (facebookPhotos[0]) {
    result = await graphUpload(`${pageId}/photos`, accessToken, { caption: message, published: "true" }, {
      buffer: facebookPhotos[0].buffer,
      mimeType: facebookPhotos[0].mimeType || "image/jpeg",
      fileName: facebookPhotos[0].fileName || "media",
    });
  } else if (media.length === 1 && media[0]?.mediaType === "video" &&
    media[0].mimeType?.toLowerCase() === "video/mp4") {
      result = await graphUpload(`${pageId}/videos`, accessToken, { description: message }, {
        buffer: media[0].buffer,
        mimeType: media[0].mimeType || "video/mp4",
        fileName: media[0].fileName || "media.mp4",
      });
  } else if (media.length > 0) {
    return { status: "failed", reason: "FACEBOOK_NO_SUPPORTED_MEDIA" };
  } else {
    result = await graphRequest(`${pageId}/feed`, accessToken, { message, published: true });
  }

  const id = typeof result.post_id === "string"
    ? result.post_id
    : typeof result.id === "string"
      ? result.id
      : null;
  if (!id) return { status: "unknown", reason: "META_RESPONSE_MISSING_POST_ID" };
  return {
    status: "published",
    postId: id,
    url: await getPermalink(id, accessToken),
    ...(omissionWarning ? { reason: omissionWarning } : {}),
  };
}

async function publishInstagram(
  instagramUserId: string,
  accessToken: string,
  post: typeof posts.$inferSelect,
  media: Awaited<ReturnType<typeof safeLocalMedia>>,
): Promise<ChannelResult> {
  if (media.length === 0) return { status: "failed", reason: "INSTAGRAM_MEDIA_REQUIRED" };
  if (media.length > 10) return { status: "failed", reason: "INSTAGRAM_CAROUSEL_REQUIRES_2_TO_10_ITEMS" };
  if (media.some((item) => item.mediaType !== "image" && item.mediaType !== "video")) {
    return { status: "failed", reason: "INSTAGRAM_MEDIA_TYPE_UNSUPPORTED" };
  }
  if (media.some((item) => item.mediaType === "image" && item.mimeType?.toLowerCase() !== "image/jpeg")) {
    return { status: "failed", reason: "INSTAGRAM_IMAGE_JPEG_REQUIRED" };
  }
  if (media.some((item) => item.mediaType === "video" && item.mimeType?.toLowerCase() !== "video/mp4")) {
    return { status: "failed", reason: "INSTAGRAM_VIDEO_MP4_REQUIRED" };
  }
  const mediaUrls = media.map((item) => {
    const url = new URL(signedWhatsAppMediaUrl(item.id));
    if (item.id.startsWith("product-media-")) {
      url.pathname = `/api/social/products/public-media/${encodeURIComponent(item.id)}`;
    }
    return url.toString();
  });
  const childIds: string[] = [];
  if (media.length > 1) {
    for (const [index, item] of media.entries()) {
      const child = await graphRequest(
        `${instagramUserId}/media`,
        accessToken,
        item.mediaType === "image"
          ? {
              image_url: mediaUrls[index],
              is_carousel_item: true,
            }
          : {
              media_type: "VIDEO",
              video_url: mediaUrls[index],
              is_carousel_item: true,
            },
        "POST",
        INSTAGRAM_REQUEST_TIMEOUT_MS,
        true,
      );
      if (typeof child.id !== "string") return { status: "failed", reason: "META_RESPONSE_MISSING_CAROUSEL_ITEM_ID" };
      childIds.push(child.id);
    }
    const childReadiness = await Promise.all(
      childIds.map((childId) => waitForInstagramContainer(childId, accessToken)),
    );
    if (childReadiness.some((ready) => !ready)) {
      return { status: "failed", reason: "INSTAGRAM_CAROUSEL_ITEM_PROCESSING_FAILED" };
    }
  }
  const primaryMedia = media[0];
  const container = media.length > 1
    ? await graphRequest(
        `${instagramUserId}/media`,
        accessToken,
        {
          media_type: "CAROUSEL",
          children: childIds.join(","),
          caption: (post.body || post.title).trim().slice(0, 2200),
        },
        "POST",
        INSTAGRAM_REQUEST_TIMEOUT_MS,
        true,
      )
    : await graphRequest(
        `${instagramUserId}/media`,
        accessToken,
        {
          caption: (post.body || post.title).trim().slice(0, 2200),
          ...(primaryMedia.mediaType === "image"
            ? { image_url: mediaUrls[0] }
            : {
                media_type: "REELS",
                video_url: mediaUrls[0],
              }),
        },
        "POST",
        INSTAGRAM_REQUEST_TIMEOUT_MS,
        true,
      );
  const creationId = typeof container.id === "string" ? container.id : null;
  if (!creationId) return { status: "failed", reason: "META_RESPONSE_MISSING_CONTAINER_ID" };

  const ready = await waitForInstagramContainer(creationId, accessToken);
  if (!ready) return { status: "failed", reason: "INSTAGRAM_MEDIA_PROCESSING_TIMEOUT" };

  const published = await graphRequest(
    `${instagramUserId}/media_publish`,
    accessToken,
    { creation_id: creationId },
    "POST",
    INSTAGRAM_REQUEST_TIMEOUT_MS,
  );
  const id = typeof published.id === "string" ? published.id : null;
  if (!id) return { status: "failed", reason: "META_RESPONSE_MISSING_POST_ID" };
  const permalink = await graphRequest(id, accessToken, { fields: "permalink" }, "GET")
    .then((response) => typeof response.permalink === "string" ? response.permalink : null)
    .catch(() => null);
  return { status: "published", postId: id, url: permalink };
}

async function waitForInstagramContainer(containerId: string, accessToken: string): Promise<boolean> {
  const deadline = Date.now() + INSTAGRAM_PROCESSING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    const status = await graphRequest(
      containerId,
      accessToken,
      { fields: "status_code,status" },
      "GET",
      Math.min(15_000, remainingMs),
    );
    const code = typeof status.status_code === "string" ? status.status_code : "";
    if (code === "FINISHED" || code === "PUBLISHED") {
      return true;
    }
    if (code === "ERROR" || code === "EXPIRED") {
      return false;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(3000, Math.max(0, deadline - Date.now()))),
    );
  }
  return false;
}

export async function publishPostToMeta(
  post: typeof posts.$inferSelect,
  channels: string[],
  onResult: (channel: string, result: ChannelResult) => Promise<void>,
  workspaceId: string,
  retryUncertain = false,
  autoPublish = post.autoPublish,
): Promise<Record<string, ChannelResult>> {
  assertPostWorkspace(post, workspaceId);
  const [persistedPost] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, post.id), eq(posts.workspaceId, workspaceId)))
    .limit(1);
  if (!persistedPost) throw new Error("POST_NOT_IN_WORKSPACE");
  post = persistedPost;
  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  if (!connection) throw new Error("META_ACCOUNT_NOT_CONNECTED");
  const accessToken = await metaConnectionAccessToken(connection);
  const recordResult = async (channel: string, result: ChannelResult) => {
    await onResult(channel, result);
    const event = makePublishActivityEvent({
      ownerId: post.ownerId,
      workspaceId: post.workspaceId,
      postId: post.id,
      accountId: channel === "facebook"
        ? connection.pageId
        : channel === "instagram"
          ? connection.instagramUserId
          : null,
      channel,
      actorId: post.ownerId,
      autoPublish,
      status: result.status,
      attemptedAt: result.attemptedAt,
      completedAt: result.status === "publishing" ? undefined : new Date().toISOString(),
      externalPostId: result.postId,
      url: result.url,
      reason: result.reason,
    });
    if (event) await db.insert(menaPostActivityEvents).values(event);
  };
  const output: Record<string, ChannelResult> = {};
  let media: Awaited<ReturnType<typeof safeLocalMedia>>;
  try {
    media = await safeLocalMedia(post);
  } catch (error) {
    const failure: ChannelResult = {
      status: "failed",
      reason: error instanceof Error ? error.message : "MEDIA_VALIDATION_FAILED",
    };
    for (const channel of channels) {
      output[channel] = failure;
      await recordResult(channel, failure);
    }
    return output;
  }

  for (const channel of channels) {
    const existing = (post.publishResults as Record<string, ChannelResult> | null)?.[channel];
    if (existing?.status === "published") {
      output[channel] = existing;
      continue;
    }
    if (existing?.status === "publishing" || existing?.status === "unknown") {
      if (channel === "facebook") {
        const decision = await decideUncertainFacebookRetry(
          retryUncertain,
          () => verifyFacebookPost(
            connection.pageId,
            accessToken,
            post,
            existing.attemptedAt,
          ),
        );
        if (decision.action === "blocked") {
          output[channel] = {
            status: "unknown",
            reason: decision.reason,
            attemptedAt: existing.attemptedAt,
          };
          continue;
        }
        if (decision.action === "uncertain") {
          output[channel] = {
            status: "unknown",
            reason: decision.reason,
            attemptedAt: existing.attemptedAt,
          };
          await recordResult(channel, output[channel]);
          continue;
        }
        if (decision.action === "published") {
          output[channel] = decision.result;
          await recordResult(channel, output[channel]);
          continue;
        }
      } else if (!retryUncertain) {
        output[channel] = { status: "unknown", reason: "PREVIOUS_RESULT_UNCERTAIN" };
        continue;
      }
    }
    const attemptedAt = new Date().toISOString();
    await recordResult(channel, {
      status: "publishing",
      reason: "PUBLISH_RESULT_PENDING",
      attemptedAt,
    });
    try {
      const channelPost = channel === "instagram"
        ? {
            ...post,
            body: typeof post.metadata === "object" &&
              post.metadata !== null &&
              typeof (post.metadata as Record<string, unknown>).instagramBody === "string"
                ? String((post.metadata as Record<string, unknown>).instagramBody)
                : post.body,
          }
        : post;
      const result = channel === "facebook"
        ? await publishFacebook(connection.pageId, accessToken, channelPost, media)
        : connection.instagramUserId
          ? await publishInstagram(connection.instagramUserId, accessToken, channelPost, media)
          : { status: "failed", reason: "INSTAGRAM_ACCOUNT_NOT_CONNECTED" } as const;
      const completed = result.status === "unknown" && !result.attemptedAt
        ? { ...result, attemptedAt }
        : result;
      output[channel] = completed;
      await recordResult(channel, completed);
    } catch (error) {
      if (error instanceof MetaNetworkError) {
        logger.error({
          channel,
          stage: error.stage,
          causeName: error.causeName,
          ...(error.causeCode ? { causeCode: error.causeCode } : {}),
        }, "Meta Graph API network request failed");
      }
      const result: ChannelResult = {
        status: error instanceof MetaApiError || error instanceof PublicMediaUrlError
          ? "failed"
          : "unknown",
        reason: error instanceof MetaNetworkError
          ? `${error.message}:${error.stage}${error.causeCode ? `:${error.causeCode}` : ""}`
          : error instanceof Error
            ? error.message
            : "META_REQUEST_FAILED",
        attemptedAt,
      };
      output[channel] = result;
      await recordResult(channel, result);
    }
  }
  return output;
}

export async function verifyFacebookPublishStatus(
  post: typeof posts.$inferSelect,
  workspaceId: string,
): Promise<FacebookRetryVerification<ChannelResult>> {
  assertPostWorkspace(post, workspaceId);
  const [persistedPost] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, post.id), eq(posts.workspaceId, workspaceId)))
    .limit(1);
  if (!persistedPost) throw new Error("POST_NOT_IN_WORKSPACE");
  post = persistedPost;
  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  if (!connection) throw new Error("META_ACCOUNT_NOT_CONNECTED");
  const accessToken = await metaConnectionAccessToken(connection);
  const facebookResult = post.publishResults &&
    typeof post.publishResults === "object" &&
    "facebook" in post.publishResults
      ? post.publishResults.facebook
      : null;
  const attemptedAt = facebookResult &&
    typeof facebookResult === "object" &&
    "attemptedAt" in facebookResult &&
    typeof facebookResult.attemptedAt === "string"
      ? facebookResult.attemptedAt
      : undefined;
  return verifyFacebookPost(connection.pageId, accessToken, post, attemptedAt);
}
