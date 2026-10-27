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

export type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

export type GeminiPart = Record<string, unknown>;

export type AiProviderOptions = {
  /** Messages in OpenAI chat-completions format. Required when calling OpenAI. */
  openAiMessages?: OpenAiMessage[];
  /** Structured response format for OpenAI (e.g. { type: "json_object" }). */
  openAiResponseFormat?: Record<string, unknown>;
  /** Contents array for Gemini generateContent. Required when calling Gemini. */
  geminiContents?: Array<{ parts: GeminiPart[] }>;
  /** System instruction text for Gemini (separate from contents). */
  geminiSystemInstruction?: string;
  /** Gemini-specific responseSchema for structured output. */
  geminiResponseSchema?: Record<string, unknown>;
  /** Gemini-specific responseMimeType (e.g. "application/json"). */
  geminiResponseMimeType?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
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

async function callOpenAI(
  options: AiProviderOptions,
): Promise<AiProviderResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("MISSING_OPENAI_KEY");
  if (!options.openAiMessages?.length)
    throw new Error("OPENAI_MESSAGES_REQUIRED");

  const model = validateModelName(process.env.OPENAI_MODEL, "gpt-4o-mini");
  const body: Record<string, unknown> = {
    model,
    messages: options.openAiMessages,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.maxTokens ?? 700,
  };
  if (options.openAiResponseFormat) {
    body.response_format = options.openAiResponseFormat;
  }

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
  const geminiBody: Record<string, unknown> = {
    contents: options.geminiContents ?? [],
    generationConfig: {
      temperature: options.temperature ?? 0.5,
      maxOutputTokens: options.maxTokens ?? 700,
      ...(options.geminiResponseMimeType
        ? { responseMimeType: options.geminiResponseMimeType }
        : {}),
      ...(options.geminiResponseSchema
        ? { responseSchema: options.geminiResponseSchema }
        : {}),
    },
  };
  if (options.geminiSystemInstruction) {
    geminiBody.systemInstruction = {
      parts: [{ text: options.geminiSystemInstruction }],
    };
  }

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
    process.env.GEMINI_MODEL,
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
        console.warn("Gemini model unavailable; trying fallback", {
          failedModel: model,
          reason: lastError.message,
        });
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
 * Calls the configured AI provider (OpenAI first, Gemini as fallback).
 * The caller can force a specific provider by passing `preferredProvider`.
 */
export async function callAiProvider(
  options: AiProviderOptions & { preferredProvider?: "openai" | "gemini" },
): Promise<AiProviderResult> {
  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  const tryGemini = () => callGemini(options);
  const tryOpenAI = () => callOpenAI(options);

  if (options.preferredProvider === "gemini") {
    if (!geminiKey) throw new Error("MISSING_GEMINI_KEY");
    return tryGemini();
  }

  if (openAiKey) {
    try {
      return await tryOpenAI();
    } catch (error) {
      if (!geminiKey) throw error;
      console.warn("AI provider (openai) failed; trying Gemini fallback", {
        reason:
          error instanceof Error ? error.message : "OPENAI_REQUEST_FAILED",
      });
      return tryGemini();
    }
  }

  if (geminiKey) return tryGemini();

  throw new Error("MISSING_AI_PROVIDER_KEY");
}
