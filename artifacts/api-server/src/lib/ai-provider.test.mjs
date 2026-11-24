import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeminiRequestBody,
  buildOpenAiRequestBody,
  callAiProvider,
} from "./ai-provider.ts";

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

test("attaches inline images only through the images option", () => {
  const body = buildGeminiRequestBody({
    geminiContents: [{ parts: [{ text: "ما المنتج في الصورة؟" }] }],
    images: [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
  });
  const parts = body.contents[0].parts;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { text: "ما المنتج في الصورة؟" });
  assert.deepEqual(parts[1], { inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
});

test("keeps the Gemini body text-only when no image is passed", () => {
  const body = buildGeminiRequestBody({
    geminiContents: [
      { parts: [{ text: "أول" }] },
      { parts: [{ text: "ثانٍ" }] },
    ],
  });
  assert.deepEqual(body.contents, [
    { parts: [{ text: "أول" }] },
    { parts: [{ text: "ثانٍ" }] },
  ]);
});

test("appends images to the last OpenAI turn as data URLs", () => {
  const body = buildOpenAiRequestBody({
    openAiMessages: [
      { role: "system", content: "تعليمات" },
      { role: "user", content: "صف المنتج" },
    ],
    images: [{ mimeType: "image/png", dataBase64: "QUJD" }],
  });
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].content, "تعليمات");
  assert.deepEqual(body.messages[1].content, [
    { type: "text", text: "صف المنتج" },
    { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
  ]);
});

test("rejects unsupported, oversized and malformed images", () => {
  assert.throws(
    () => buildOpenAiRequestBody({
      openAiMessages: [{ role: "user", content: "x" }],
      images: [{ mimeType: "image/gif", dataBase64: "QUJD" }],
    }),
    { message: "AI_IMAGE_MIME_UNSUPPORTED" },
  );
  assert.throws(
    () => buildGeminiRequestBody({
      geminiContents: [{ parts: [{ text: "x" }] }],
      images: [{ mimeType: "image/jpeg", dataBase64: "not base64!" }],
    }),
    { message: "AI_IMAGE_DATA_INVALID" },
  );
  assert.throws(
    () => buildGeminiRequestBody({
      geminiContents: [{ parts: [{ text: "x" }] }],
      images: Array.from({ length: 5 }, () => ({ mimeType: "image/jpeg", dataBase64: "QUJD" })),
    }),
    { message: "AI_TOO_MANY_IMAGES" },
  );
});

test("sanitizes media links in the text turn of a vision call", () => {
  const body = buildGeminiRequestBody({
    geminiContents: [{
      parts: [{ text: "الصورة على https://cdn.example.test/a.jpg?token=secret" }],
    }],
    images: [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
  });
  const serialized = JSON.stringify(body);
  assert.match(serialized, /\[media link omitted\]/);
  assert.doesNotMatch(serialized, /token=secret/);
});

test("per-call model overrides win over the environment defaults", () => {
  const previousOpenAiModel = process.env.OPENAI_MODEL;
  const previousGeminiModel = process.env.GEMINI_MODEL;
  process.env.OPENAI_MODEL = "gpt-4o-mini";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  try {
    assert.equal(
      buildOpenAiRequestBody({
        openAiMessages: [{ role: "user", content: "x" }],
        openAiModel: "gpt-4o",
      }).model,
      "gpt-4o",
    );
    assert.equal(
      buildOpenAiRequestBody({
        openAiMessages: [{ role: "user", content: "x" }],
      }).model,
      "gpt-4o-mini",
    );
    assert.throws(
      () => buildOpenAiRequestBody({
        openAiMessages: [{ role: "user", content: "x" }],
        openAiModel: "gpt-4o;rm -rf",
      }),
      { message: "AI_MODEL_NAME_INVALID" },
    );
    assert.equal(
      buildGeminiRequestBody({
        geminiContents: [{ parts: [{ text: "x" }] }],
        geminiModel: "gemini-2.5-pro",
      }).generationConfig.temperature,
      0.5,
    );
  } finally {
    if (previousOpenAiModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previousOpenAiModel;
    if (previousGeminiModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousGeminiModel;
  }
});
