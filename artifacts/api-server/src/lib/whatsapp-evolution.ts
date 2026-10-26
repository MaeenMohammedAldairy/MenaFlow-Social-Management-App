import { timingSafeEqual } from "node:crypto";

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
  let response: globalThis.Response;
  try {
    response = await fetch(new URL(path, baseUrl), {
      ...options,
      headers: {
        Accept: "application/json",
        apikey: apiKey,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new EvolutionApiError(504, "EVOLUTION_API_TIMEOUT");
    }
    throw new EvolutionApiError(502, "EVOLUTION_API_UNREACHABLE");
  }

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
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

export async function evolutionConnectionState(
  instanceName: string,
): Promise<string> {
  const payload = await evolutionRequest(
    `instance/connectionState/${encodeURIComponent(instanceName)}`,
  );
  const state = connectionStateFrom(payload);
  if (!state) throw new EvolutionApiError(502, "EVOLUTION_API_INVALID_RESPONSE");
  return state;
}

export function whatsappWebhookUrl(): string {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_WEBHOOK_URL?.trim();
  const development = process.env.NODE_ENV !== "production";
  const domain = development ? process.env.REPLIT_DEV_DOMAIN?.trim() : undefined;
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
