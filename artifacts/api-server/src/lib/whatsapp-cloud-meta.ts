import { getMetaGraphVersion } from "./meta-graph-config.ts";

const REQUIRED_PERMISSIONS = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

type JsonRecord = Record<string, unknown>;

export type WhatsAppCloudPhoneNumber = {
  metaPhoneNumberId: string;
  phoneNumber: string;
  verifiedName: string | null;
  codeVerificationStatus: string | null;
  qualityRating: string | null;
  platformType: string | null;
};

export type WhatsAppCloudInspection = {
  messagingAccountId: string;
  grantedPermissions: string[];
  phoneNumbers: WhatsAppCloudPhoneNumber[];
};

export class WhatsAppCloudMetaError extends Error {
  readonly code:
    | "META_CONFIGURATION_MISSING"
    | "META_REQUEST_FAILED"
    | "META_PERMISSION_MISSING"
    | "META_ASSET_MISMATCH";
  readonly httpStatus: number;
  readonly metaCode: number | null;

  constructor(
    code: WhatsAppCloudMetaError["code"],
    httpStatus: number,
    metaCode: number | null = null,
  ) {
    super(code);
    this.name = "WhatsAppCloudMetaError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.metaCode = metaCode;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseWhatsAppCloudTestMessagingAccountIds(
  configuredIds: string | undefined,
): Set<string> | null {
  if (!configuredIds?.trim()) return null;

  const ids = configuredIds.split(",").map((id) => id.trim());
  if (ids.some((id) => !EXTERNAL_ID_PATTERN.test(id))) return null;
  return new Set(ids);
}

function normalizePhoneNumber(value: unknown): WhatsAppCloudPhoneNumber | null {
  if (!isRecord(value)) return null;
  const metaPhoneNumberId = nonEmptyString(value.id);
  const phoneNumber = nonEmptyString(value.display_phone_number);
  if (!metaPhoneNumberId || !phoneNumber) return null;
  return {
    metaPhoneNumberId,
    phoneNumber,
    verifiedName: nonEmptyString(value.verified_name),
    codeVerificationStatus: nonEmptyString(value.code_verification_status),
    qualityRating: nonEmptyString(value.quality_rating),
    platformType: nonEmptyString(value.platform_type),
  };
}

async function graphGet(
  accessToken: string,
  path: string,
  fetcher: typeof fetch,
): Promise<unknown> {
  const version = getMetaGraphVersion();
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new WhatsAppCloudMetaError("META_CONFIGURATION_MISSING", 503);
  }

  const [pathValue, queryValue] = path.split("?", 2);
  const url = new URL(
    `https://graph.facebook.com/${version}/${pathValue
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  );
  if (queryValue) url.search = queryValue;
  const response = await fetcher(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new WhatsAppCloudMetaError("META_REQUEST_FAILED", 502);
  }

  if (!response.ok) {
    const metaError = isRecord(payload) && isRecord(payload.error)
      ? payload.error
      : null;
    const metaCode =
      typeof metaError?.code === "number" ? metaError.code : null;
    throw new WhatsAppCloudMetaError(
      "META_REQUEST_FAILED",
      response.status === 401 || metaCode === 190 ? 401 : 502,
      metaCode,
    );
  }

  return payload;
}

export async function inspectWhatsAppCloudAssets(
  accessToken: string,
  messagingAccountId: string,
  expectedPhoneNumberId: string,
  fetcher: typeof fetch = fetch,
): Promise<WhatsAppCloudInspection> {
  const [accountPayload, numbersPayload, permissionsPayload] =
    await Promise.all([
      graphGet(accessToken, messagingAccountId, fetcher),
      graphGet(
        accessToken,
        `${messagingAccountId}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,quality_rating,platform_type`,
        fetcher,
      ),
      graphGet(accessToken, "me/permissions", fetcher),
    ]);

  const accountId =
    isRecord(accountPayload) ? nonEmptyString(accountPayload.id) : null;
  if (accountId !== messagingAccountId) {
    throw new WhatsAppCloudMetaError("META_ASSET_MISMATCH", 422);
  }

  const rawNumbers =
    isRecord(numbersPayload) && Array.isArray(numbersPayload.data)
      ? numbersPayload.data
      : [];
  const phoneNumbers = rawNumbers
    .map(normalizePhoneNumber)
    .filter((number): number is WhatsAppCloudPhoneNumber => number !== null);
  if (!phoneNumbers.some((number) => number.metaPhoneNumberId === expectedPhoneNumberId)) {
    throw new WhatsAppCloudMetaError("META_ASSET_MISMATCH", 422);
  }

  const rawPermissions =
    isRecord(permissionsPayload) && Array.isArray(permissionsPayload.data)
      ? permissionsPayload.data
      : [];
  const grantedPermissions = rawPermissions.flatMap((permission) => {
    if (!isRecord(permission) || permission.status !== "granted") return [];
    const permissionName = nonEmptyString(permission.permission);
    return permissionName ? [permissionName] : [];
  });
  if (
    REQUIRED_PERMISSIONS.some(
      (permission) => !grantedPermissions.includes(permission),
    )
  ) {
    throw new WhatsAppCloudMetaError("META_PERMISSION_MISSING", 422);
  }

  return {
    messagingAccountId,
    grantedPermissions,
    phoneNumbers,
  };
}
