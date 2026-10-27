export type ParsedPublishRequest = {
  channels: unknown;
  retryUncertain: boolean;
};

export function parsePublishRequestBody(body: unknown): ParsedPublishRequest | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.retryUncertain !== undefined && typeof value.retryUncertain !== "boolean") {
    return null;
  }
  return {
    channels: value.channels,
    retryUncertain: value.retryUncertain === true,
  };
}

export type FacebookRetryVerification<T> =
  | { status: "found"; result: T }
  | { status: "not-found" }
  | {
      status: "unavailable";
      reason?: "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED" | "FACEBOOK_RESULT_CANNOT_BE_VERIFIED";
    };

export function classifyFacebookVerification<T>(input: {
  result?: T;
  completedEdges: number;
  requiredEdges: number;
  errors: Array<{ code?: number }>;
}): FacebookRetryVerification<T> {
  if (input.result !== undefined) return { status: "found", result: input.result };
  if (input.errors.some((error) => error.code === 10)) {
    return { status: "unavailable", reason: "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED" };
  }
  if (input.errors.length > 0 || input.completedEdges < input.requiredEdges) {
    return { status: "unavailable", reason: "FACEBOOK_RESULT_CANNOT_BE_VERIFIED" };
  }
  return { status: "not-found" };
}

export type FacebookRetryDecision<T> =
  | { action: "publish" }
  | { action: "blocked"; reason: "PREVIOUS_RESULT_UNCERTAIN" }
  | { action: "published"; result: T }
  | {
      action: "uncertain";
      reason: "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED" | "FACEBOOK_RESULT_CANNOT_BE_VERIFIED";
    };

export async function decideUncertainFacebookRetry<T>(
  retryConfirmed: boolean,
  verifyExistingPost: () => Promise<FacebookRetryVerification<T>>,
): Promise<FacebookRetryDecision<T>> {
  if (!retryConfirmed) {
    return { action: "blocked", reason: "PREVIOUS_RESULT_UNCERTAIN" };
  }

  const verification = await verifyExistingPost();
  if (verification.status === "found") {
    return { action: "published", result: verification.result };
  }
  if (verification.status === "unavailable") {
    return {
      action: "uncertain",
      reason: verification.reason ?? "FACEBOOK_RESULT_CANNOT_BE_VERIFIED",
    };
  }
  return { action: "publish" };
}
