import assert from "node:assert/strict";
import test from "node:test";
import { generateDraft } from "./whatsapp-marketing-ai.ts";

test("generates and normalizes a draft through the injected caller", async () => {
  const calls = [];
  const callProvider = async (options) => {
    calls.push(options);
    return {
      content: JSON.stringify({
        eligible: true,
        title: "  عرض تجريبي  ",
        facebook: "  نص فيسبوك  ",
        instagram: "  نص إنستغرام  ",
        reason: "  مناسب  ",
      }),
      model: "test-model",
    };
  };

  const result = await generateDraft("تفاصيل عرض تجريبي", callProvider);

  assert.equal(calls.length, 1);
  const options = calls[0];
  assert.match(options.openAiMessages[1].content, /تفاصيل عرض تجريبي/);
  assert.deepEqual(options.openAiResponseFormat, { type: "json_object" });
  assert.equal(options.temperature, 0.2);
  assert.equal(options.maxTokens, 900);
  assert.equal(JSON.stringify(options).search(/image_url|inlineData|base64/), -1);
  assert.equal(result.model, "test-model");
  assert.deepEqual(result.draft, {
    eligible: true,
    title: "عرض تجريبي",
    facebook: "نص فيسبوك",
    instagram: "نص إنستغرام",
    reason: "مناسب",
  });
});

test("repairs an unparseable response through the same injected caller", async () => {
  const calls = [];
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-gemini-key";

  const callProvider = async (options) => {
    calls.push(options);
    if (calls.length === 1) {
      return { content: "not json at all", model: "first-model" };
    }
    return {
      content: JSON.stringify({
        eligible: false,
        title: "",
        facebook: "",
        instagram: "",
        reason: "not commercial",
      }),
      model: "repair-model",
    };
  };

  try {
    const result = await generateDraft("synthetic message", callProvider);

    assert.equal(calls.length, 2);
    assert.equal(calls[1].preferredProvider, "gemini");
    assert.equal(result.model, "repair-model");
    assert.equal(result.draft.eligible, false);
    assert.equal(result.draft.reason, "not commercial");
  } finally {
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});

test("fails explicitly when the provider returns an invalid assessment", async () => {
  const callProvider = async () => ({
    content: JSON.stringify({ title: "no eligibility flag" }),
    model: "test-model",
  });

  await assert.rejects(
    generateDraft("synthetic message", callProvider),
    { message: "AI_INVALID_ASSESSMENT" },
  );
});
