/**
 * Expo Push Service client: payload shape, batching and ticket handling.
 *
 * Pure apart from one injected `fetch`, so the error classification — the part
 * worth testing — runs in CI without a network and without a database.
 *
 * Scope note: this handles *tickets*, which is the response to a send request
 * and the only place Expo reports `DeviceNotRegistered`. Expo also offers a
 * second *receipts* endpoint that reports whether a delivered message reached
 * the device. Receipts are deliberately not implemented: nothing in this
 * product can act on "accepted but not delivered" differently from "delivered",
 * while tickets do carry an actionable signal (stop using this token).
 */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Expo accepts at most 100 messages per request. */
export const MAX_MESSAGES_PER_REQUEST = 100;

/** Expo rejects any single message larger than 4 KB. */
export const MAX_MESSAGE_BYTES = 4096;

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** `default` is the only value Android and iOS both honour. */
  sound?: string;
  badge?: number;
  priority?: "default" | "normal" | "high";
  /** Required on Android 8+ for sound and importance to apply. */
  channelId?: string;
  ttl?: number;
};

export type PushTicketError = {
  message: string;
  /** Expo's machine-readable code, e.g. `DeviceNotRegistered`. */
  code?: string;
};

export type PushTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; error: PushTicketError };

export type SendPushResult = {
  /** Tickets Expo accepted. Acceptance is not delivery. */
  accepted: number;
  /** Tokens Expo will never accept again — the caller must disable them. */
  deviceNotRegistered: string[];
  /** Tokens whose failure may be transient; the caller may retry. */
  retryable: string[];
  /** Failures that retrying cannot fix, e.g. an oversized payload. */
  permanent: string[];
  /** Set when the whole request was rejected, e.g. HTTP 429 or 5xx. */
  requestError?: string;
  /** First per-ticket error text, for `last_error` on the outbox row. */
  lastErrorMessage?: string;
  /** Seconds to wait before the next attempt, from a 429 `Retry-After`. */
  retryAfterSeconds?: number;
};

/**
 * Errors Expo returns per ticket that are worth distinguishing. Everything not
 * listed here is treated as retryable, because an unknown code is more likely
 * to be transient than fatal and dropping an alert silently is the worse
 * failure.
 */
const PERMANENT_ERROR_CODES = new Set([
  "MessageTooBig",
  "InvalidCredentials",
]);

export function chunkPushMessages(
  messages: PushMessage[],
  size = MAX_MESSAGES_PER_REQUEST,
): PushMessage[][] {
  if (size <= 0) throw new Error("chunk size must be positive");
  const chunks: PushMessage[][] = [];
  for (let index = 0; index < messages.length; index += size) {
    chunks.push(messages.slice(index, index + size));
  }
  return chunks;
}

/**
 * Builds one Expo message from a notification and a token.
 *
 * `channelId` is set for Android only — on iOS an unknown channel id is
 * ignored, but on Android a message without one lands in a default channel
 * that the merchant cannot configure.
 */
export function toPushMessage(
  token: string,
  notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  },
  options: { platform?: string | null; badge?: number } = {},
): PushMessage {
  const isAndroid = options.platform === "android";
  return {
    to: token,
    title: notification.title,
    body: notification.body,
    data: notification.data ?? {},
    sound: "default",
    priority: "high",
    ...(isAndroid ? { channelId: "menaflow-alerts" } : {}),
    ...(typeof options.badge === "number" ? { badge: options.badge } : {}),
    // Four hours. An alert older than that is stale: a customer message from
    // yesterday arriving at breakfast is noise, not a notification.
    ttl: 4 * 60 * 60,
  };
}

export function buildPushRequestInit(
  messages: PushMessage[],
  accessToken?: string | null,
): RequestInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
    // The Expo response can be large for a 100-message batch.
    "accept-encoding": "gzip, deflate",
  };
  if (accessToken?.trim()) headers.authorization = `Bearer ${accessToken.trim()}`;

  return {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  // Expo sends delta-seconds, not an HTTP date.
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Maps Expo's response onto what the caller has to do next.
 *
 * `data` is aligned to the request by index, so a ticket at position i belongs
 * to messages[i]. Expo documents that ordering; relying on it is what makes
 * per-token disabling possible at all.
 */
export function classifyPushResponse(
  payload: unknown,
  messages: PushMessage[],
): SendPushResult {
  const result: SendPushResult = {
    accepted: 0,
    deviceNotRegistered: [],
    retryable: [],
    permanent: [],
  };

  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    result.requestError = "EXPO_RESPONSE_MISSING_DATA";
    result.retryable = messages.map((message) => message.to);
    return result;
  }

  data.forEach((ticket, index) => {
    const token = messages[index]?.to;
    if (!token) return;

    const status = (ticket as PushTicket | null)?.status;
    if (status === "ok") {
      result.accepted += 1;
      return;
    }

    const details = (ticket as { details?: { error?: string } } | null)?.details;
    const code = details?.error;
    const message =
      (ticket as { message?: string } | null)?.message ?? "UNKNOWN_TICKET_ERROR";

    // Keeps the first ticket error, which is the one worth putting in
    // last_error; a batch of failures almost always shares a single cause.
    result.lastErrorMessage ??= code ? `${code}: ${message}` : message;

    if (code === "DeviceNotRegistered") {
      result.deviceNotRegistered.push(token);
      return;
    }
    if (code && PERMANENT_ERROR_CODES.has(code)) {
      result.permanent.push(token);
      return;
    }
    result.retryable.push(token);
  });

  return result;
}

export type SendPushOptions = {
  accessToken?: string | null;
  fetchImpl?: typeof fetch;
  /** Exposed for tests; defaults to the production endpoint. */
  url?: string;
  timeoutMs?: number;
};

/**
 * Sends one batch and reports what happened per token.
 *
 * Never throws for a per-ticket failure — only for a transport failure, which
 * the caller turns into a retry. That distinction matters: a rejected token is
 * a data problem to record, while a dropped request is a reason to try again.
 */
export async function sendPushBatch(
  messages: PushMessage[],
  options: SendPushOptions = {},
): Promise<SendPushResult> {
  if (messages.length === 0) {
    return { accepted: 0, deviceNotRegistered: [], retryable: [], permanent: [] };
  }
  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    throw new Error(
      `sendPushBatch accepts at most ${MAX_MESSAGES_PER_REQUEST} messages, received ${messages.length}`,
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(options.url ?? EXPO_PUSH_URL, {
      ...buildPushRequestInit(messages, options.accessToken),
      signal: controller.signal,
    });

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      return {
        accepted: 0,
        deviceNotRegistered: [],
        retryable: messages.map((message) => message.to),
        permanent: [],
        requestError: "EXPO_RATE_LIMITED",
        retryAfterSeconds,
      };
    }

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      // 5xx and unexpected 4xx are transport-level: retry the whole batch.
      const detail = (payload as { errors?: Array<{ message?: string }> } | null)
        ?.errors?.[0]?.message;
      return {
        accepted: 0,
        deviceNotRegistered: [],
        retryable: messages.map((message) => message.to),
        permanent: [],
        requestError: detail ?? `EXPO_HTTP_${response.status}`,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
      };
    }

    return classifyPushResponse(payload, messages);
  } catch (error) {
    const reason = error instanceof Error ? error.name : "Error";
    return {
      accepted: 0,
      deviceNotRegistered: [],
      retryable: messages.map((message) => message.to),
      permanent: [],
      requestError: `EXPO_REQUEST_FAILED:${reason}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
