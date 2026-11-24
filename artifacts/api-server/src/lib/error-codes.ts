/**
 * One registry for application error codes. The class decides behaviour in the
 * server (retry or not, which HTTP status) and the message key decides what the
 * app shows, so neither side needs to pattern-match on prose.
 */
export type ErrorClass =
  | "retryable"
  | "user_action"
  | "config"
  | "unknown_outcome";

export type ErrorDefinition = {
  class: ErrorClass;
  httpStatus: number;
  messageKey: string;
};

const errorDefinitions: Record<string, ErrorDefinition> = {
  // Quotas and entitlements: the merchant has to change something.
  SUBSCRIPTION_LIMIT_REACHED: {
    class: "user_action",
    httpStatus: 403,
    messageKey: "subscription.limit_reached",
  },
  ENTITLEMENT_DENIED: {
    class: "user_action",
    httpStatus: 403,
    messageKey: "subscription.entitlement_denied",
  },
  SUBSCRIPTION_TRANSITION_INVALID: {
    class: "user_action",
    httpStatus: 409,
    messageKey: "subscription.transition_invalid",
  },
  USAGE_EVENT_DUPLICATE: {
    class: "user_action",
    httpStatus: 409,
    messageKey: "subscription.usage_duplicate",
  },

  // Configuration: only the operator can fix these.
  WORKSPACE_SUBSCRIPTION_MISSING: {
    class: "config",
    httpStatus: 500,
    messageKey: "subscription.configuration_missing",
  },
  WORKSPACE_SUBSCRIPTION_PLAN_INVALID: {
    class: "config",
    httpStatus: 500,
    messageKey: "subscription.plan_invalid",
  },
  MISSING_AI_PROVIDER_KEY: {
    class: "config",
    httpStatus: 500,
    messageKey: "ai.provider_key_missing",
  },
  MISSING_OPENAI_KEY: {
    class: "config",
    httpStatus: 500,
    messageKey: "ai.provider_key_missing",
  },
  MISSING_GEMINI_KEY: {
    class: "config",
    httpStatus: 500,
    messageKey: "ai.provider_key_missing",
  },
  AI_MODEL_NAME_INVALID: {
    class: "config",
    httpStatus: 500,
    messageKey: "ai.model_invalid",
  },

  // Provider output that may succeed on a second attempt with the same input.
  AI_INVALID_JSON_RESPONSE: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.invalid_response",
  },
  AI_INVALID_ASSESSMENT: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.invalid_response",
  },
  OPENAI_EMPTY_RESPONSE: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.empty_response",
  },
  GEMINI_EMPTY_RESPONSE: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.empty_response",
  },
  OPENAI_INCOMPLETE_RESPONSE: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.empty_response",
  },
  GEMINI_INCOMPLETE_RESPONSE: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.empty_response",
  },

  AI_PROVIDER_ERROR: {
    class: "retryable",
    httpStatus: 502,
    messageKey: "ai.provider_error",
  },

  // A request may have reached the outside world; never retried automatically.
  META_SEND_RESULT_UNKNOWN: {
    class: "unknown_outcome",
    httpStatus: 202,
    messageKey: "meta.send_result_unknown",
  },
  MANUAL_SEND_RESULT_UNKNOWN: {
    class: "unknown_outcome",
    httpStatus: 202,
    messageKey: "meta.send_result_unknown",
  },
};

export function errorDefinition(code: string): ErrorDefinition | null {
  const normalized = code.trim();
  if (!normalized) return null;
  const base = normalized.includes(":")
    ? normalized.slice(0, normalized.indexOf(":"))
    : normalized;
  return errorDefinitions[base] ?? null;
}

export function errorClass(code: string): ErrorClass {
  return errorDefinition(code)?.class ?? "config";
}

export function isRetryableErrorCode(code: string): boolean {
  return errorClass(code) === "retryable";
}

export function errorMessageKey(code: string): string {
  return errorDefinition(code)?.messageKey ?? "error.unexpected";
}

export function errorHttpStatus(code: string): number {
  return errorDefinition(code)?.httpStatus ?? 500;
}

export function registeredErrorCodes(): string[] {
  return Object.keys(errorDefinitions);
}

/** Longest value an `error_code` column in this schema holds. */
export const MAX_ERROR_CODE_LENGTH = 80;

/**
 * Shape of a code this registry can classify: `UPPER_SNAKE`, optionally with a
 * `:suffix` naming the limit or resource (`SUBSCRIPTION_LIMIT_REACHED:aiGenerations`).
 *
 * Anything else is not a code and must not be stored as one. Two real failures
 * motivated the check: recording `error.name` stores `"Error"` for most faults,
 * which tells the merchant nothing, and recording a raw `error.message` can
 * store a provider's prose — including text from a model response — in a column
 * the app renders back to the merchant.
 */
const STABLE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}(?::[A-Za-z0-9_.-]{1,64})?$/;

/**
 * Returns `value` when it is a stable machine code, otherwise null so the
 * caller can fall back to something it knows is safe to store.
 */
export function stableErrorCode(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_ERROR_CODE_LENGTH) return null;
  return STABLE_ERROR_CODE.test(trimmed) ? trimmed : null;
}

/**
 * Codes that mean an automatic reply was never generated, so nothing was sent
 * and no customer is waiting on half a delivery.
 *
 * Both reply queues spend the same workspace AI quota and read the same
 * configuration, and every code here lifts on its own — at the next billing
 * period, or as soon as the operator supplies the missing key. Recording one as
 * a failure therefore turns a temporary limit into a permanently lost reply,
 * and tells the merchant a send failed that never happened.
 */
export const autoReplyGenerationPausedCodes = [
  "SUBSCRIPTION_LIMIT_REACHED",
  "WORKSPACE_SUBSCRIPTION_MISSING",
  "WORKSPACE_SUBSCRIPTION_PLAN_INVALID",
  "MISSING_OPENAI_KEY",
  "MISSING_GEMINI_KEY",
  "MISSING_AI_PROVIDER_KEY",
  "AI_MODEL_NAME_INVALID",
] as const;

export function isAutoReplyGenerationPausedCode(
  reason: string | null | undefined,
): boolean {
  const code = reason?.trim() ?? "";
  if (!code) return false;
  return autoReplyGenerationPausedCodes.some(
    (candidate) =>
      code === candidate ||
      code.startsWith(`${candidate}:`) ||
      code.includes(candidate),
  );
}

/**
 * `"skipped"` means paused by a limit that lifts by itself; `"failed"` means a
 * real generation or send fault.
 */
export function classifyAutoReplyGenerationFailure(
  reason: string,
): "skipped" | "failed" {
  return isAutoReplyGenerationPausedCode(reason) ? "skipped" : "failed";
}
