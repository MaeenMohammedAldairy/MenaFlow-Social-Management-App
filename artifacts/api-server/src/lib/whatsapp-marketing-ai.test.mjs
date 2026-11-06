import assert from "node:assert/strict";
import test from "node:test";
import { generateDraft } from "./whatsapp-marketing-ai.ts";

test("generates and normalizes a draft through the configured OpenAI provider", async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousOpenAiModel = process.env.OPENAI_MODEL;
  const originalFetch = globalThis.fetch;
  let request;

  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  process.env.OPENAI_MODEL = "test-model";
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              eligible: true,
              title: "  عرض تجريبي  ",
              facebook: "  نص فيسبوك  ",
              instagram: "  نص إنستغرام  ",
              reason: "  مناسب  ",
            }),
          },
        }],
      }),
    };
  };

  try {
    const result = await generateDraft("تفاصيل عرض تجريبي");

    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-openai-key");
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.model, "test-model");
    assert.match(payload.messages[1].content, /تفاصيل عرض تجريبي/);
    assert.doesNotMatch(request.options.body, /image_url|inlineData|base64/);
    assert.equal(result.model, "test-model");
    assert.deepEqual(result.draft, {
      eligible: true,
      title: "عرض تجريبي",
      facebook: "نص فيسبوك",
      instagram: "نص إنستغرام",
      reason: "مناسب",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
    if (previousOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousOpenAiModel;
  }
});

test("fails explicitly when neither AI provider is configured", async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    await assert.rejects(
      generateDraft("synthetic message"),
      { message: "MISSING_AI_PROVIDER_KEY" },
    );
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});
