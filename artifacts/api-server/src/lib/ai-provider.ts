/**
 * ai-provider.ts
 *
 * Shared HTTP dispatch layer for OpenAI and Gemini.
 * All business-specific prompt building stays in the calling modules;
 * only the low-level network calls and model-name validation live here.
 *
 * Usage pattern:
 *   const result = await callAiProvider({
 *     openAiMessages: [...],           // when you need OpenAI chat format
 *     geminiContents: [...],           // when you need Gemini generateContent format
 *     geminiSystemInstruction: "...",  // optional Gemini system prompt
 *     temperature: 0.3,
 *     maxTokens: 800,
 *     timeoutMs: 20_000,
 *   });
 *   // result.content — raw text from the model
 *   // result.model   — resolved model name (for logging)
 */

import { logger } from "./logger.ts";
import {
  applyProviderCooldown,
  describeAiProviderPlan,
  emptyAiProviderCooldowns,
  planAiProviders,
  type AiProviderCooldowns,
  type AiProviderName,
} from "./ai-provider-fallback.ts";

export type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GeminiPart = { text: string };

/**
 * An inline image for the rare vision-enabled callers. Images travel as base64
 * so no storage object ever has to be made public for a model to see it.
 * Text stays the default: every other caller keeps the text-only guarantee.
 */
export type AiImage = {
  mimeType: string;
  dataBase64: string;
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Cap on inline images per call; extraction needs a product shot, not an album. */
export const MAX_AI_IMAGES_PER_CALL = 4;

/** Cap on the base64 payload per image (≈6 MB decoded). */
export const MAX_AI_IMAGE_BASE64_LENGTH = 8_000_000;

export function validateAiImages(images: readonly AiImage[] | undefined): AiImage[] {
  if (!images?.length) return [];
  if (images.length > MAX_AI_IMAGES_PER_CALL) {
    throw new Error("AI_TOO_MANY_IMAGES");
  }
  return images.map((image) => {
    if (
      !image ||
      typeof image.mimeType !== "string" ||
      typeof image.dataBase64 !== "string"
    ) {
      throw new Error("AI_IMAGE_REQUIRED");
    }
    const mimeType = image.mimeType.trim().toLowerCase();
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error("AI_IMAGE_MIME_UNSUPPORTED");
    }
    const dataBase64 = image.dataBase64.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
      throw new Error("AI_IMAGE_DATA_INVALID");
    }
    if (dataBase64.length > MAX_AI_IMAGE_BASE64_LENGTH) {
      throw new Error("AI_IMAGE_TOO_LARGE");
    }
    if (!dataBase64.length) throw new Error("AI_IMAGE_DATA_INVALID");
    return { mimeType, dataBase64 };
  });
}

export type GeminiResponseFormat = {
  text: {
    mimeType: string;
    schema?: Record<string, unknown>;
  };
};

export type AiProviderOptions = {
  /** Messages in OpenAI chat-completions format. Required when calling OpenAI. */
  openAiMessages?: OpenAiMessage[];
  /** Structured response format for OpenAI (e.g. { type: "json_object" }). */
  openAiResponseFormat?: Record<string, unknown>;
  /** Contents array for Gemini generateContent. Required when calling Gemini. */
  geminiContents?: Array<{ parts: GeminiPart[] }>;
  /** System instruction text for Gemini (separate from contents). */
  geminiSystemInstruction?: string;
  /** Gemini response format for generateContent. */
  geminiResponseFormat?: GeminiResponseFormat;
  /**
   * Optional inline images for vision-capable callers. Omit to keep the call
   * text-only, which is the default for every existing feature.
   */
  images?: AiImage[];
  /** Model override for this call; validated like the environment default. */
  openAiModel?: string;
  /** Model override for this call; validated like the environment default. */
  geminiModel?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type AiProviderCallOptions = AiProviderOptions & {
  preferredProvider?: AiProviderName;
  /**
   * Attempt a provider even while it is inside its throttle cooldown. Use for
   * an explicit merchant-triggered retry, never for background workers.
   */
  ignoreProviderCooldowns?: boolean;
};

export type AiProviderResult = {
  content: string;
  model: string;
  provider: "openai" | "gemini";
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function validateModelName(
  raw: string | undefined,
  fallback: string,
): string {
  const model = raw?.trim() || fallback;
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new Error("AI_MODEL_NAME_INVALID");
  }
  return model;
}

function normalizeGeminiResponseMimeType(mimeType: string): string {
  switch (mimeType) {
    case "application/json":
      return "APPLICATION_JSON";
    case "text/plain":
      return "TEXT_PLAIN";
    default:
      throw new Error("GEMINI_RESPONSE_MIME_TYPE_UNSUPPORTED");
  }
}

function isMediaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.replace(/[),.;!?]+$/, ""));
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    /\.(?:avif|bmp|gif|heic|heif|jpe?g|m4v|mkv|mov|mp4|mpeg|mpg|png|svg|webm|webp)$/i.test(url.pathname) ||
    /(?:^|\.)((?:fbcdn\.net)|(?:cdninstagram\.com)|(?:fbsbx\.com)|(?:mmg\.whatsapp\.net))$/.test(host) ||
    /\/(?:storage\/v1\/object|product-media|whatsapp-media|media|attachments?)(?:\/|$)/i.test(url.pathname)
  );
}

function sanitizeAiText(value: string): string {
  return value
    .replace(/data:(?:image|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[media omitted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) =>
      isMediaUrl(url) ? "[media link omitted]" : url,
    );
}

function textOnlyGeminiContents(
  contents: Array<{ parts: GeminiPart[] }> | undefined,
): Array<{ parts: GeminiPart[] }> {
  return (contents ?? []).map((content) => ({
    parts: content.parts.map((part) => {
      if (
        !part ||
        typeof part !== "object" ||
        typeof part.text !== "string" ||
        Object.keys(part).some((key) => key !== "text")
      ) {
        throw new Error("AI_TEXT_ONLY_CONTENT_REQUIRED");
      }
      return { text: sanitizeAiText(part.text) };
    }),
  }));
}

function textOnlyOpenAiMessages(messages: OpenAiMessage[] | undefined): OpenAiMessage[] {
  return (messages ?? []).map((message) => {
    if (!message || typeof message.content !== "string") {
      throw new Error("AI_TEXT_ONLY_CONTENT_REQUIRED");
    }
    return { ...message, content: sanitizeAiText(message.content) };
  });
}

/**
 * Appends validated inline images to the last user turn. Text parts keep going
 * through `textOnlyGeminiContents`, so a caller cannot smuggle an image in by
 * adding a key to a part: images are only accepted through `options.images`.
 */
export function geminiContentsWithImages(
  contents: Array<{ parts: GeminiPart[] }>,
  images: readonly AiImage[],
): Array<{
  parts: Array<GeminiPart | { inlineData: { mimeType: string; data: string } }>;
}> {
  if (images.length === 0) return contents;
  const target = contents.length - 1;
  return contents.map((content, index) =>
    index === target
      ? {
          parts: [
            ...content.parts,
            ...images.map((image) => ({
              inlineData: { mimeType: image.mimeType, data: image.dataBase64 },
            })),
          ],
        }
      : { parts: [...content.parts] },
  );
}

export function buildGeminiRequestBody(
  options: AiProviderOptions,
): Record<string, unknown> {
  const geminiContents = geminiContentsWithImages(
    textOnlyGeminiContents(options.geminiContents),
    validateAiImages(options.images),
  );
  const responseFormat = options.geminiResponseFormat
    ? {
        ...options.geminiResponseFormat,
        text: {
          ...options.geminiResponseFormat.text,
          mimeType: normalizeGeminiResponseMimeType(
            options.geminiResponseFormat.text.mimeType,
          ),
        },
      }
    : undefined;
  const body: Record<string, unknown> = {
    contents: geminiContents,
    generationConfig: {
      temperature: options.temperature ?? 0.5,
      maxOutputTokens: options.maxTokens ?? 700,
      ...(responseFormat ? { responseFormat } : {}),
    },
  };
  if (options.geminiSystemInstruction) {
    body.systemInstruction = {
      parts: [{ text: sanitizeAiText(options.geminiSystemInstruction) }],
    };
  }
  return body;
}

/**
 * OpenAI chat body builder. Exported so the vision shape and the model pinning
 * can be asserted without a network call.
 */
export function openAiMessagesWithImages(
  messages: OpenAiMessage[],
  images: readonly AiImage[],
): Array<{ role: OpenAiMessage["role"]; content: unknown }> {
  if (images.length === 0) return messages;
  const target = messages.length - 1;
  return messages.map((message, index) =>
    index === target
      ? {
          role: message.role,
          content: [
            { type: "text", text: message.content },
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
            })),
          ],
        }
      : message,
  );
}

export function buildOpenAiRequestBody(
  options: AiProviderOptions,
): Record<string, unknown> {
  const model = validateModelName(
    options.openAiModel ?? process.env.OPENAI_MODEL,
    "gpt-4o-mini",
  );
  const images = validateAiImages(options.images);
  const messages = openAiMessagesWithImages(
    textOnlyOpenAiMessages(options.openAiMessages),
    images,
  );
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 700,
  };
  if (options.openAiResponseFormat) {
    body.response_format = options.openAiResponseFormat;
  }
  return body;
}

async function callOpenAI(
  options: AiProviderOptions,
): Promise<AiProviderResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("MISSING_OPENAI_KEY");
  if (!options.openAiMessages?.length)
    throw new Error("OPENAI_MESSAGES_REQUIRED");

  const body = buildOpenAiRequestBody(options);
  const model = String(body.model);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null };
      finish_reason?: string | null;
    }>;
  };
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new Error("OPENAI_INCOMPLETE_RESPONSE");
  const content = choice?.message?.content?.trim();
  if (!content) throw new Error("OPENAI_EMPTY_RESPONSE");
  return { content, model, provider: "openai" };
}

async function callGeminiModel(
  modelName: string,
  geminiKey: string,
  options: AiProviderOptions,
): Promise<string> {
  const geminiBody = buildGeminiRequestBody(options);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": geminiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(geminiBody),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    },
  );

  if (!response.ok) throw new Error(`GEMINI_HTTP_${response.status}`);

  const payload = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS")
    throw new Error("GEMINI_INCOMPLETE_RESPONSE");
  const content = candidate?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("GEMINI_EMPTY_RESPONSE");
  return content;
}

async function callGemini(
  options: AiProviderOptions,
): Promise<AiProviderResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("MISSING_GEMINI_KEY");
  if (!options.geminiContents?.length && !options.geminiSystemInstruction) {
    throw new Error("GEMINI_CONTENTS_REQUIRED");
  }

  const preferredModel = validateModelName(
    options.geminiModel ?? process.env.GEMINI_MODEL,
    "gemini-2.5-flash",
  );
  const fallbackModel = "gemini-flash-lite-latest";
  const models = [...new Set([preferredModel, fallbackModel])];

  let lastError: Error = new Error("GEMINI_EMPTY_RESPONSE");
  for (const model of models) {
    try {
      const content = await callGeminiModel(model, key, options);
      return { content, model, provider: "gemini" };
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("GEMINI_REQUEST_FAILED");
      const retryable =
        lastError.name === "TypeError" ||
        lastError.name === "TimeoutError" ||
        lastError.message === "GEMINI_EMPTY_RESPONSE" ||
        lastError.message === "GEMINI_INCOMPLETE_RESPONSE" ||
        /GEMINI_HTTP_(404|429|500|502|503|504)/.test(lastError.message);
      if (model !== models.at(-1) && retryable) {
        logger.warn(
          {
            failedModel: model,
            reason: lastError.message,
          },
          "Gemini model unavailable; trying fallback",
        );
        continue;
      }
      throw lastError;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process-wide throttle state. A provider that answers `429` (or rejects the
 * key) is not asked again until its cooldown expires, so a queue of fifty jobs
 * costs one failed request instead of fifty.
 */
const providerCooldowns: AiProviderCooldowns = { ...emptyAiProviderCooldowns };
const lastProviderFailure: Partial<Record<AiProviderName, string>> = {};

/** Clears the throttle state. Used by tests and by an operator retry endpoint. */
export function resetAiProviderCooldowns(): void {
  providerCooldowns.openai = 0;
  providerCooldowns.gemini = 0;
  delete lastProviderFailure.openai;
  delete lastProviderFailure.gemini;
}

/** Read-only view of the throttle state, for diagnostics endpoints and tests. */
export function aiProviderCooldownSnapshot(now: number = Date.now()): Record<
  AiProviderName,
  { coolingDown: boolean; remainingMs: number; lastReason: string | null }
> {
  const snapshot = (provider: AiProviderName) => ({
    coolingDown: providerCooldowns[provider] > now,
    remainingMs: Math.max(0, providerCooldowns[provider] - now),
    lastReason: lastProviderFailure[provider] ?? null,
  });
  return { openai: snapshot("openai"), gemini: snapshot("gemini") };
}

const providerCallers: Record<
  AiProviderName,
  (options: AiProviderOptions) => Promise<AiProviderResult>
> = {
  openai: callOpenAI,
  gemini: callGemini,
};

/**
 * Calls the configured AI provider (OpenAI first, Gemini as fallback).
 * The caller can force a specific provider by passing `preferredProvider`,
 * which is honoured unless that provider is inside its throttle cooldown.
 */
export async function callAiProvider(
  options: AiProviderCallOptions,
): Promise<AiProviderResult> {
  const now = Date.now();
  const plan = planAiProviders({
    openAiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
    geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
    preferredProvider: options.preferredProvider,
    cooldowns: providerCooldowns,
    now,
    ignoreCooldowns: options.ignoreProviderCooldowns,
  });

  if (plan.order.length === 0) {
    if (
      plan.skipped.length === 2 &&
      plan.skipped.every((item) => item.reason === "MISSING_KEY")
    ) {
      throw new Error("MISSING_AI_PROVIDER_KEY");
    }
    // Everything that has a key is throttled: surface the reason that put it
    // there so existing error-to-message mapping keeps working.
    const throttled = plan.skipped.find((item) =>
      item.reason.startsWith("COOLING_DOWN"),
    );
    const reason = throttled
      ? lastProviderFailure[throttled.provider]
      : undefined;
    logger.warn(
      { plan: describeAiProviderPlan(plan) },
      "No AI provider attempted; all configured providers are cooling down",
    );
    throw new Error(reason ?? "AI_PROVIDER_COOLING_DOWN");
  }

  if (plan.skipped.length) {
    logger.info(
      { plan: describeAiProviderPlan(plan) },
      "AI provider plan adjusted",
    );
  }

  let lastError: Error = new Error("AI_PROVIDER_UNAVAILABLE");
  for (const provider of plan.order) {
    try {
      return await providerCallers[provider](options);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("AI_PROVIDER_REQUEST_FAILED");
      lastProviderFailure[provider] = lastError.message;
      const remaining = plan.order.slice(plan.order.indexOf(provider) + 1);
      Object.assign(
        providerCooldowns,
        applyProviderCooldown(providerCooldowns, provider, lastError.message, Date.now()),
      );
      if (remaining.length === 0) throw lastError;
      logger.warn(
        {
          provider,
          reason: lastError.message,
          next: remaining[0],
          cooldownRemainingMs: Math.max(0, providerCooldowns[provider] - Date.now()),
        },
        "AI provider failed; trying fallback",
      );
    }
  }
  throw lastError;
}
