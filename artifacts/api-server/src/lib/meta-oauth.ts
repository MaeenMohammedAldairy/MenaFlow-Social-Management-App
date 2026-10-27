export type MetaPermission = {
  permission?: string;
  status?: string;
};

export type MetaIntegration = "facebook" | "instagram";

export const META_BASE_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  "instagram_content_publish",
] as const;

export const META_INTEGRATION_SCOPES: Record<
  MetaIntegration,
  readonly string[]
> = {
  facebook: [
    "pages_manage_engagement",
    "pages_messaging",
    "pages_manage_metadata",
  ],
  instagram: [
    "instagram_manage_comments",
    "instagram_manage_messages",
    "pages_manage_metadata",
  ],
};

export type MetaGraphErrorDetails = {
  code?: number;
  subcode?: number;
  type?: string;
  message?: string;
};

export function metaOAuthScopes(integration: MetaIntegration): string[] {
  return [...META_BASE_OAUTH_SCOPES, ...META_INTEGRATION_SCOPES[integration]];
}

export function grantedMetaPermissions(
  permissions: readonly MetaPermission[] | undefined,
): string[] {
  const granted = new Set<string>();
  for (const { permission, status } of permissions ?? []) {
    if (permission && status === "granted") granted.add(permission);
  }
  return [...granted];
}

export function missingMetaIntegrationPermissions(
  integration: MetaIntegration,
  grantedPermissions: readonly string[],
): string[] {
  const granted = new Set(grantedPermissions);
  return META_INTEGRATION_SCOPES[integration].filter(
    (permission) => !granted.has(permission),
  );
}

export function hasGrantedMetaPageListPermission(
  permissions: readonly MetaPermission[] | undefined,
): boolean {
  return (
    permissions?.some(
      ({ permission, status }) =>
        permission === "pages_show_list" && status === "granted",
    ) ?? false
  );
}

export function metaGraphErrorDetails(
  payload: unknown,
): MetaGraphErrorDetails | undefined {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("error" in payload)
  ) {
    return undefined;
  }

  const error = payload.error;
  if (!error) return undefined;
  if (typeof error !== "object") return {};

  const details: MetaGraphErrorDetails = {};
  if ("code" in error && typeof error.code === "number") {
    details.code = error.code;
  }
  if ("error_subcode" in error && typeof error.error_subcode === "number") {
    details.subcode = error.error_subcode;
  }
  if ("type" in error && typeof error.type === "string") {
    details.type = error.type;
  }
  if ("message" in error && typeof error.message === "string") {
    const message = error.message.trim().slice(0, 300);
    const containsCredential =
      /(?:access_token|client_secret|fb_exchange_token|authorization code|oauth code)\s*[=:]/i.test(
        message,
      );
    const containsToken = /\b(?:EA[A-Z0-9]{15,}|IG[A-Z0-9]{15,})\b/i.test(
      message,
    );
    if (message && !containsCredential && !containsToken) {
      details.message = message;
    }
  }
  return details;
}
