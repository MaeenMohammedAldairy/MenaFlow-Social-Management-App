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
  replitDevDomain?: string;
  replitDomains?: string;
  expoPublicDomain?: string;
  requestOrigin?: string;
  allowDeploymentFallbacks?: boolean;
}): string | null {
  const loopbackRequestOrigin = resolveLoopbackRequestOrigin(input.requestOrigin);
  if (loopbackRequestOrigin) return loopbackRequestOrigin;

  const configuredBase = input.configuredBase?.trim();
  const allowDeploymentFallbacks = input.allowDeploymentFallbacks !== false;
  const replitDomain = allowDeploymentFallbacks
    ? input.replitDevDomain?.trim() ||
      input.replitDomains?.split(",").map((domain) => domain.trim()).find(Boolean)
    : undefined;
  let candidate = configuredBase || replitDomain;
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
