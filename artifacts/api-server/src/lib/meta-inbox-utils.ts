export function metaString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function metaWebhookCallbackUrl(
  publicBaseUrl: string | undefined,
  oauthRedirectUri: string | undefined,
): string | null {
  const configuredBase = publicBaseUrl?.trim() || oauthRedirectUri?.trim();
  if (!configuredBase) return null;
  try {
    const url = new URL(configuredBase);
    url.pathname = "/api/social/meta/webhook";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
