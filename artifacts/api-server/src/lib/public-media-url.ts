/**
 * public-media-url.ts
 *
 * How a stored media file — a WhatsApp attachment or a product image — is
 * exposed to the merchant's app over HTTPS without making the bucket public.
 *
 * Two halves. The base URL is resolved from configuration (`MENA_PUBLIC_MEDIA_BASE_URL`,
 * then the app domain, with a development-only loopback exception) and every
 * caller that builds a URL has to agree on it or images render on one screen
 * and not the next. The URL is then signed: an HMAC over the media id, the
 * expiry and the variant, verified by the two public-media routes before any
 * byte is read.
 *
 * This is not Meta-specific, and it used to sit inside `meta-publishing.ts`,
 * the Graph publishing module — so the WhatsApp message routes, the product
 * routes and the post serializer all imported the whole publisher (and ran its
 * import-time media-root resolution) to sign a URL. It lives here now, next to
 * the base-URL resolution it builds on.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { metaTokenEncryptionKey } from "./meta-token-crypto.ts";

export type PublicMediaUrlReason =
  | "PUBLIC_MEDIA_BASE_URL_REQUIRED"
  | "PUBLIC_MEDIA_BASE_URL_INVALID"
  | "PUBLIC_MEDIA_URL_MUST_USE_HTTPS";

export class PublicMediaUrlError extends Error {
  readonly reason: PublicMediaUrlReason;

  constructor(reason: PublicMediaUrlReason) {
    super(reason);
    this.reason = reason;
  }
}

function resolveLoopbackRequestOrigin(requestOrigin?: string): string | null {
  if (!requestOrigin) return null;
  try {
    const url = new URL(requestOrigin);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      !["localhost", "127.0.0.1", "::1"].includes(hostname)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolvePublicMediaBaseUrl(input: {
  configuredBase?: string;
  expoPublicDomain?: string;
  requestOrigin?: string;
  allowDeploymentFallbacks?: boolean;
}): string | null {
  const loopbackRequestOrigin = resolveLoopbackRequestOrigin(input.requestOrigin);
  if (loopbackRequestOrigin) return loopbackRequestOrigin;

  const configuredBase = input.configuredBase?.trim();
  const allowDeploymentFallbacks = input.allowDeploymentFallbacks !== false;
  let candidate = configuredBase;
  if (!candidate) {
    const expoPublicDomain = allowDeploymentFallbacks
      ? input.expoPublicDomain?.trim()
      : undefined;
    if (!expoPublicDomain) return null;
    try {
      const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(expoPublicDomain)
        ? expoPublicDomain
        : `https://${expoPublicDomain}`;
      const url = new URL(normalized);
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (
        hostname === "localhost" ||
        hostname === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(hostname)
      ) return null;
      candidate = expoPublicDomain;
    } catch {
      throw new PublicMediaUrlError("PUBLIC_MEDIA_BASE_URL_INVALID");
    }
  }
  if (!candidate) return null;

  try {
    const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`;
    const url = new URL(normalized);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      throw new Error("invalid public media URL");
    }
    return url.origin;
  } catch {
    throw new PublicMediaUrlError("PUBLIC_MEDIA_BASE_URL_INVALID");
  }
}

export function signedWhatsAppMediaUrl(
  mediaId: string,
  allowLocalHttp = false,
  variant: "original" | "thumbnail" | "instagram-jpeg" = "original",
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
  if (variant !== "original") url.searchParams.set("variant", variant);
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
  variant: "original" | "thumbnail" | "instagram-jpeg",
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
  variant: "original" | "thumbnail" | "instagram-jpeg" = "original",
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
