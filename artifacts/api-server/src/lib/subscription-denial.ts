import {
  errorClass,
  errorHttpStatus,
  errorMessageKey,
  isRetryableErrorCode,
} from "./error-codes.ts";

export const SUBSCRIPTION_LIMIT_CODE = "SUBSCRIPTION_LIMIT_REACHED";

/**
 * The meter a denial is about. Each one gets its own merchant-facing sentence,
 * so the app never has to parse the code to know what was reached.
 */
export type DenialMeter = "postsCreated" | "aiGenerations" | "channels";

const denialMessages: Record<DenialMeter, string> = {
  postsCreated:
    "بلغت الحد الشهري للمنشورات في خطتك الحالية. تظهر خيارات الترقية قريبًا.",
  aiGenerations: "بلغت الحد الشهري لتوليد المحتوى في خطتك الحالية.",
  channels:
    "بلغت الحد الأقصى لقنوات خطتك الحالية. تظهر خيارات الترقية قريبًا.",
};

export type ErrorPayload = {
  error: string;
  code: string;
  errorClass: string;
  messageKey: string;
  retryable: boolean;
};

/**
 * One envelope for every error the API returns with a code, so the app reads
 * `messageKey`/`retryable` instead of matching on prose, and the HTTP status
 * always comes from the registry rather than from each call site.
 */
export function errorPayload(code: string, message: string): ErrorPayload {
  return {
    error: message,
    code,
    errorClass: errorClass(code),
    messageKey: errorMessageKey(code),
    retryable: isRetryableErrorCode(code),
  };
}

export function errorStatus(code: string): number {
  return errorHttpStatus(code);
}

export type DenialBody = ErrorPayload & {
  meter: DenialMeter;
  usage?: number;
  limit?: number;
};

export function subscriptionDenial(
  meter: DenialMeter,
  quota?: { used: number; limit: number },
): { status: number; body: DenialBody } {
  const body: DenialBody = {
    ...errorPayload(SUBSCRIPTION_LIMIT_CODE, denialMessages[meter]),
    meter,
  };
  // Usage is omitted when the caller cannot know it (for example a quota
  // enforced inside the database), instead of reporting a misleading zero.
  if (quota) {
    body.usage = quota.used;
    body.limit = quota.limit;
  }
  return { status: errorHttpStatus(SUBSCRIPTION_LIMIT_CODE), body };
}
