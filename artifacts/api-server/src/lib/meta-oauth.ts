import { isRecord } from "./value-utils.ts";

export type MetaPermission = {
  permission?: string;
  status?: string;
};

export type MetaIntegration = "facebook" | "instagram";

export type MetaAutoReplyKind = "message" | "comment";

export type MetaConnectionOwnershipConflict =
  | "facebook_page"
  | "instagram_account";

export function canManageMetaConnections(role: string): boolean {
  return role === "owner";
}

export function normalizeMetaAccountId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("INVALID_META_ACCOUNT_ID");
  const normalized = value.trim();
  if (!normalized) throw new Error("INVALID_META_ACCOUNT_ID");
  return normalized;
}

export function metaConnectionConflictFromError(
  error: unknown,
): MetaConnectionOwnershipConflict | null {
  if (!isRecord(error)) return null;
  const candidates = [error, error.cause].filter(isRecord);
  for (const candidate of candidates) {
    if (candidate.code !== "23505") continue;
    if (candidate.constraint === "mena_meta_connections_page_id_key") {
      return "facebook_page";
    }
    if (
      candidate.constraint === "mena_meta_connections_instagram_user_id_key"
    ) {
      return "instagram_account";
    }
  }
  return null;
}

export function metaConnectionConflictDetail(
  account: MetaConnectionOwnershipConflict,
): string {
  return account === "facebook_page"
    ? "صفحة Facebook هذه مرتبطة بالفعل بمساحة عمل أخرى."
    : "حساب Instagram هذا مرتبط بالفعل بمساحة عمل أخرى.";
}

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

export function metaAuthorizationStatus(
  connection: {
    authorizationVerifiedAt: Date | null;
    accessTokenExpiresAt: Date | null;
    grantedPermissions: string[];
  },
  integration: MetaIntegration,
  now = new Date(),
) {
  const missingPermissions = connection.authorizationVerifiedAt
    ? missingMetaIntegrationPermissions(
        integration,
        connection.grantedPermissions,
      )
    : [];
  const tokenExpired =
    connection.accessTokenExpiresAt !== null &&
    connection.accessTokenExpiresAt <= now;
  const authorizationReason = tokenExpired
    ? "token_expired"
    : !connection.authorizationVerifiedAt
      ? "permissions_unverified"
      : missingPermissions.length > 0
        ? "permissions_missing"
        : null;

  return {
    authorizationStatus: authorizationReason
      ? "needs_reauthorization"
      : "ready",
    authorizationReason,
    missingPermissions,
    accessTokenExpiresAt:
      connection.accessTokenExpiresAt?.toISOString() ?? null,
  } as const;
}

export function metaAutoReplyPermission(
  integration: MetaIntegration,
  kind: MetaAutoReplyKind,
): string {
  if (kind === "message") {
    return integration === "facebook"
      ? "pages_messaging"
      : "instagram_manage_messages";
  }
  return integration === "facebook"
    ? "pages_manage_engagement"
    : "instagram_manage_comments";
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
