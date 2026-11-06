import { timingSafeEqual } from "node:crypto";
import { asRecord as record } from "./value-utils.ts";

export class EvolutionApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function verifyWhatsAppWebhookSecret(
  provided: string | string[] | undefined,
): boolean {
  const supplied = Array.isArray(provided) ? provided[0] : provided;
  const expected =
    process.env.WHATSAPP_EVOLUTION_WEBHOOK_SECRET?.trim() ||
    process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  if (!supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export function isExclusiveWhatsAppInstance(
  ownerId: string,
  connectionOwnerIds: string[],
): boolean {
  return connectionOwnerIds.length === 1 && connectionOwnerIds[0] === ownerId;
}

function evolutionApiConfig(): { baseUrl: URL; apiKey: string } {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL?.trim();
  const apiKey = process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  if (!configuredUrl || !apiKey) {
    throw new EvolutionApiError(503, "EVOLUTION_API_NOT_CONFIGURED");
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(
      configuredUrl.endsWith("/") ? configuredUrl : `${configuredUrl}/`,
    );
  } catch {
    throw new EvolutionApiError(503, "EVOLUTION_API_URL_INVALID");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new EvolutionApiError(503, "EVOLUTION_API_URL_INVALID");
  }

  return { baseUrl, apiKey };
}

export async function evolutionRequest(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<unknown> {
  const { baseUrl, apiKey } = evolutionApiConfig();
  const controller = new AbortController();
  const requestSignal = options.signal;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortWithRequest = () => controller.abort(requestSignal?.reason);
  if (requestSignal?.aborted) {
    abortWithRequest();
  } else {
    requestSignal?.addEventListener("abort", abortWithRequest, { once: true });
  }

  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        Accept: "application/json",
        apikey: apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new EvolutionApiError(404, "EVOLUTION_INSTANCE_NOT_FOUND");
      }
      throw new EvolutionApiError(502, "EVOLUTION_API_REQUEST_FAILED");
    }
    const responseText = await response.text();
    if (responseText.trim() === "") return null;
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
    }
    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error
    ) {
      throw new EvolutionApiError(502, "EVOLUTION_API_REQUEST_FAILED");
    }
    return payload;
  } catch (error) {
    if (error instanceof EvolutionApiError) throw error;
    if (timedOut || (error instanceof Error && error.name === "TimeoutError")) {
      throw new EvolutionApiError(504, "EVOLUTION_API_TIMEOUT");
    }
    if (requestSignal?.aborted) throw error;
    throw new EvolutionApiError(502, "EVOLUTION_API_UNREACHABLE");
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", abortWithRequest);
  }
}

function connectionStateFrom(payload: unknown): string | null {
  const body = record(payload);
  const instance = record(body?.instance);
  const data = record(body?.data);
  const dataInstance = record(data?.instance);
  const state =
    instance?.state ?? dataInstance?.state ?? body?.state ?? data?.state;
  return typeof state === "string" ? state.toLowerCase() : null;
}

export type WhatsAppConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "failed"
  | "unavailable";

export function mapEvolutionConnectionState(
  state: string,
  setupFailed = false,
): WhatsAppConnectionState {
  if (state === "open") return "connected";
  if (setupFailed) return "failed";
  if (state === "connecting") return "connecting";
  if (["close", "closed", "refused", "logout"].includes(state)) {
    return "disconnected";
  }
  return "unavailable";
}

// Short-lived cache so read-heavy screens (connections list, account details)
// do not block on a synchronous Evolution API round trip on every request.
// Errors are cached briefly too, to avoid stampeding a failing provider.
const CONNECTION_STATE_CACHE_TTL_MS = 10_000;
const ERROR_CACHE_TTL_MS = 3_000;
const connectionStateCache = new Map<
  string,
  { expiresAt: number; value: string | EvolutionApiError }
>();

export function clearConnectionStateCache(): void {
  connectionStateCache.clear();
}

export async function evolutionConnectionState(
  instanceName: string,
): Promise<string> {
  const cached = connectionStateCache.get(instanceName);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    if (cached.value instanceof EvolutionApiError) throw cached.value;
    return cached.value;
  }
  try {
    const payload = await evolutionRequest(
      `instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    const state = connectionStateFrom(payload);
    if (!state) throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
    connectionStateCache.set(instanceName, {
      value: state,
      expiresAt: now + CONNECTION_STATE_CACHE_TTL_MS,
    });
    return state;
  } catch (error) {
    if (error instanceof EvolutionApiError) {
      connectionStateCache.set(instanceName, {
        value: error,
        expiresAt: now + ERROR_CACHE_TTL_MS,
      });
    }
    throw error;
  }
}

export function whatsappWebhookUrl(): string {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_WEBHOOK_URL?.trim();
  const development = process.env.NODE_ENV !== "production";
  const domain = development ? process.env.EXPO_PUBLIC_DOMAIN?.trim() : undefined;
  const port = Number(process.env.PORT ?? 5000);

  if (configuredUrl) {
    let url: URL;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    if (
      !development &&
      (url.protocol !== "https:" ||
        ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
          url.hostname,
        ))
    ) {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    return url.toString();
  }

  if (domain) {
    let baseUrl: URL;
    try {
      baseUrl = new URL(domain.includes("://") ? domain : `https://${domain}`);
    } catch {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
    }
    baseUrl.pathname = "/api/social/whatsapp/webhook";
    baseUrl.search = "";
    baseUrl.hash = "";
    return baseUrl.toString();
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_INVALID");
  }

  if (!development) {
    throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_URL_REQUIRED");
  }
  return `http://host.docker.internal:${port}/api/social/whatsapp/webhook`;
}

export async function configureWhatsAppWebhook(
  instanceName: string,
): Promise<void> {
  const webhookSecret =
    process.env.WHATSAPP_EVOLUTION_WEBHOOK_SECRET?.trim() ||
    process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  if (!webhookSecret) {
    throw new EvolutionApiError(503, "WHATSAPP_WEBHOOK_SECRET_REQUIRED");
  }
  await evolutionRequest(
    `webhook/set/${encodeURIComponent(instanceName)}`,
    {
      method: "POST",
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: whatsappWebhookUrl(),
          headers: { "x-evolution-api-key": webhookSecret },
          webhookByEvents: false,
          webhookBase64: false,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_SET",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
          ],
        },
      }),
    },
  );
}
