export function resolveMetaWebReturnOrigin(
  origin: string | undefined,
  configuredDomains: string[],
  configuredOrigins: string | undefined,
): string | undefined {
  if (!origin) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("META_RETURN_ORIGIN_INVALID");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("META_RETURN_ORIGIN_INVALID");
  }

  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  for (const configuredDomain of configuredDomains) {
    for (const candidate of configuredDomain.split(",")) {
      const domain = candidate.trim();
      if (!domain) continue;
      try {
        allowedHosts.add(
          new URL(domain.includes("://") ? domain : `https://${domain}`).hostname,
        );
      } catch {
        throw new Error("META_RETURN_ORIGIN_INVALID");
      }
    }
  }

  const allowedOrigins = new Set<string>();
  for (const candidate of configuredOrigins?.split(",") ?? []) {
    const configuredOrigin = candidate.trim();
    if (!configuredOrigin) continue;
    try {
      const parsedConfiguredOrigin = new URL(configuredOrigin);
      if (
        (parsedConfiguredOrigin.protocol !== "http:" &&
          parsedConfiguredOrigin.protocol !== "https:") ||
        parsedConfiguredOrigin.origin !== configuredOrigin ||
        parsedConfiguredOrigin.username ||
        parsedConfiguredOrigin.password
      ) {
        throw new Error("META_RETURN_ORIGIN_INVALID");
      }
      allowedOrigins.add(parsedConfiguredOrigin.origin);
    } catch {
      throw new Error("META_RETURN_ORIGIN_INVALID");
    }
  }

  if (!allowedHosts.has(parsed.hostname) && !allowedOrigins.has(parsed.origin)) {
    throw new Error("META_RETURN_ORIGIN_INVALID");
  }
  return parsed.origin;
}
