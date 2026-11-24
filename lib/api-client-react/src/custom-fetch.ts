export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  /**
   * Deadline for this request, including reading the response body.
   *
   * Omit it to get the default for the payload shape (`DEFAULT_READ_TIMEOUT_MS`,
   * or `DEFAULT_UPLOAD_TIMEOUT_MS` for a binary body); pass `null` for a request
   * meant to stay open, such as an event stream.
   */
  timeoutMs?: number | null;
};

/** The same option for `fetchApiResponse`, whose deadline stops at the headers. */
export type FetchApiResponseOptions = RequestInit & {
  timeoutMs?: number | null;
};

/**
 * Deadlines applied when a caller does not ask for one.
 *
 * Nothing in the app passed `timeoutMs` at all, so a server that accepted the
 * connection and then stalled left every screen on its loading state forever:
 * React Query never flips to `isError`, so no retry affordance appears either —
 * the merchant sees a skeleton with no way out and no explanation. Twenty
 * seconds is longer than any healthy call to this API and shorter than a
 * merchant's patience.
 *
 * Uploads get more because the payload is a media file read off the device and
 * sent over a mobile connection. Cutting an upload short after the bytes were
 * already sent costs the merchant a re-pick and the server a discarded write.
 */
export const DEFAULT_READ_TIMEOUT_MS = 20_000;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _workspaceIdGetter: (() => string | null | Promise<string | null>) | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * This is used by both native and web clients. The API is cross-origin from
 * the Expo web app, so web requests also need the explicit bearer token.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

/**
 * Register a getter that supplies the active workspace ID.  Before every
 * fetch the getter is invoked; when it returns a non-null string, an
 * `x-workspace-id` header is attached to the request.
 *
 * Call this once after the user has selected (or been assigned) a workspace.
 * Pass `null` to clear the getter (e.g. on sign-out).
 */
export function setWorkspaceIdGetter(
  getter: (() => string | null | Promise<string | null>) | null,
): void {
  _workspaceIdGetter = getter;
}

/**
 * Whether a request body is a payload whose size the client cannot bound, and
 * which therefore earns the upload deadline rather than the read one.
 *
 * A JSON string is bounded by what the merchant typed; a blob read off the
 * device is not.
 */
export function isLongUploadBody(body: unknown): boolean {
  if (body === null || body === undefined || typeof body === "string") return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof ArrayBuffer !== "undefined") {
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return true;
  // An unrecognised object payload (a host-specific file or stream wrapper):
  // assume it can be large rather than aborting an upload at twenty seconds.
  return typeof body === "object";
}

/**
 * The deadline for one request: the caller's explicit value, `null` for "stay
 * open", or the default for the payload shape. Pure, so the rule is testable
 * without a network.
 */
export function resolveRequestTimeoutMs(options: {
  timeoutMs?: number | null;
  body?: unknown;
}): number | null {
  const { timeoutMs, body } = options;
  if (timeoutMs === null) return null;
  if (timeoutMs !== undefined) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError(
        "timeoutMs must be a positive finite number, or null for no deadline",
      );
    }
    return timeoutMs;
  }
  return isLongUploadBody(body) ? DEFAULT_UPLOAD_TIMEOUT_MS : DEFAULT_READ_TIMEOUT_MS;
}

/**
 * Run `task` under a deadline, keeping a caller's cancellation distinct from a
 * timeout: aborting yields an `AbortError`, expiring yields a `TimeoutError`.
 * The task receives the combined signal, so the in-flight fetch is actually
 * cancelled rather than merely ignored.
 */
async function runWithDeadline<T>(
  task: (signal: AbortSignal | undefined) => Promise<T>,
  options: { timeoutMs: number | null; signal?: AbortSignal | null },
): Promise<T> {
  const { timeoutMs, signal: callerSignal } = options;
  if (timeoutMs === null) return task(callerSignal ?? undefined);

  const controller = new AbortController();
  let rejectCancellation: ((error: Error) => void) | undefined;
  const cancellation = callerSignal
    ? new Promise<never>((_resolve, reject) => {
        rejectCancellation = reject;
      })
    : null;
  const abortFromCaller = () => {
    controller.abort();
    const error = new Error("Request aborted");
    error.name = "AbortError";
    rejectCancellation?.(error);
  };
  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller();
    else callerSignal.addEventListener("abort", abortFromCaller, { once: true });
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const timeout = new Error("Request timed out");
      timeout.name = "TimeoutError";
      controller.abort();
      reject(timeout);
    }, timeoutMs);
  });

  try {
    return await (cancellation
      ? Promise.race([task(controller.signal), deadline, cancellation])
      : Promise.race([task(controller.signal), deadline]));
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function sendApiRequest(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  input = applyBaseUrl(input);
  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, init.headers);
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  if (_workspaceIdGetter && !headers.has("x-workspace-id")) {
    const workspaceId = await _workspaceIdGetter();
    if (workspaceId) headers.set("x-workspace-id", workspaceId);
  }
  const signal = init.signal ?? (isRequest(input) ? input.signal : undefined);
  if (signal?.aborted) {
    const error = new Error("Request aborted");
    error.name = "AbortError";
    throw error;
  }
  return fetch(input, { ...init, headers });
}

/**
 * Send a request with the shared auth and workspace headers.
 *
 * The deadline covers obtaining the response **headers** — including a stalled
 * session-token getter — and not the body afterwards: a caller streaming an
 * event response reads that body for as long as the connection lives, which is
 * what `timeoutMs: null` expresses.
 */
export async function fetchApiResponse(
  input: RequestInfo | URL,
  init: FetchApiResponseOptions = {},
): Promise<Response> {
  const { timeoutMs, ...requestInit } = init;
  const method =
    requestInit.method ?? (isRequest(input) ? input.method : undefined) ?? "GET";
  const deadline = resolveRequestTimeoutMs({ timeoutMs, body: requestInit.body });
  return runWithDeadline(
    (signal) => sendApiRequest(input, { ...requestInit, method, signal }),
    {
      timeoutMs: deadline,
      signal: requestInit.signal ?? (isRequest(input) ? requestInit.signal : undefined),
    },
  );
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * The merchant-facing message: the server's own words when it sent any, and the
 * HTTP status line only when it sent none.
 *
 * Screens render `error.message` directly — `app/compose.tsx`, the conversation
 * reply box, the account-details screen — and this API answers every failure
 * with an Arabic `error` string. Prefixing that with "HTTP 422 Unprocessable
 * Entity:" put an English status line in front of the only sentence that tells
 * the merchant what to do, and left `lib/content-utils.ts` guessing whether a
 * failure reason was human text or a technical code. `status` and `statusText`
 * stay on the error for code paths and for logs.
 */
function buildErrorMessage(response: Response, data: unknown): string {
  const statusLine = `HTTP ${response.status} ${response.statusText}`.trim();

  if (typeof data === "string") {
    const text = data.trim();
    return text ? truncate(text) : statusLine;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${title} — ${detail}`;
  return detail ?? message ?? title ?? statusLine;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const { responseType = "auto", timeoutMs, headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  const requestInfo = { method, url: resolveUrl(input) };
  const deadline = resolveRequestTimeoutMs({ timeoutMs, body: init.body });
  const callerSignal = init.signal ?? (isRequest(input) ? input.signal : undefined);

  // One deadline for the whole round trip: the session-token getter, the
  // response headers and reading the body. `sendApiRequest` is called directly
  // rather than `fetchApiResponse` so the same request is not armed twice.
  return runWithDeadline(
    async (signal) => {
      const response = await sendApiRequest(input, { ...init, method, headers, signal });
      if (!response.ok) {
        const errorData = await parseErrorBody(response, method);
        throw new ApiError(response, errorData, requestInfo);
      }
      return (await parseSuccessBody(response, responseType, requestInfo)) as T;
    },
    { timeoutMs: deadline, signal: callerSignal },
  );
}

/**
 * Read a JSON body, or throw the `ApiError` the generated client throws.
 *
 * The hand-written clients in the mobile app each carried their own copy of this
 * function and threw a bare `Error`, which the app's global error routing cannot
 * read: `reportApiError` in the root layout keys off `error.name === "ApiError"`
 * to raise the session banner on 401, the permission notice on 403 and the
 * server notice with a retry on 5xx, and off `error.status` to decide that a 4xx
 * must not be retried. A bare `Error` got none of that — and, carrying no status,
 * was retried three times even when the server had just refused the request.
 *
 * `parseFailureMessage` keeps the Arabic copy these clients already showed when a
 * 2xx body turns out not to be JSON: that case is a broken contract rather than a
 * refused request, so it stays a plain `Error`.
 */
export async function readJsonResponse<T>(
  response: Response,
  options: {
    method?: string;
    url?: string;
    parseFailureMessage?: string;
  } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const requestInfo = { method, url: options.url ?? response.url };

  if (!response.ok) {
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  const normalized = stripBom(await response.text());
  try {
    return JSON.parse(normalized) as T;
  } catch {
    throw new Error(options.parseFailureMessage ?? "تعذر قراءة استجابة الخادم.");
  }
}
