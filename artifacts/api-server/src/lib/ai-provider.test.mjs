import assert from "node:assert/strict";
import test from "node:test";
import { buildGeminiRequestBody, callAiProvider } from "./ai-provider.ts";

test("keeps Gemini prompts text-only and removes media links and data URIs", () => {
  const body = buildGeminiRequestBody({
    geminiContents: [{
      parts: [{
        text: "شاهد https://cdn.example.test/photo.jpg?token=secret data:image/png;base64,AAAA",
      }],
    }],
    geminiSystemInstruction: "تعليمات نصية",
  });
  const serialized = JSON.stringify(body);

  assert.match(serialized, /شاهد/);
  assert.match(serialized, /\[media link omitted\]/);
  assert.match(serialized, /\[media omitted\]/);
  assert.doesNotMatch(serialized, /photo\.jpg|data:image\/png|AAAA/);
  assert.doesNotMatch(serialized, /inlineData|image_url/);
});

test("rejects non-text Gemini parts at the provider boundary", () => {
  assert.throws(
    () => buildGeminiRequestBody({
      geminiContents: [{
        parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }],
      }],
    }),
    { message: "AI_TEXT_ONLY_CONTENT_REQUIRED" },
  );
});

test("rejects non-text OpenAI messages before making a provider request", async () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  process.env.OPENAI_API_KEY = "test-openai-key";
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("provider should not be called");
  };

  try {
    await assert.rejects(
      callAiProvider({
        openAiMessages: [{
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.test/a.jpg" } }],
        }],
      }),
      { message: "AI_TEXT_ONLY_CONTENT_REQUIRED" },
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});
