import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetaAutoReplySystemInstruction,
  buildMetaAutoReplyPrompt,
  metaAutoReplyEnabled,
  metaPostSearchTerms,
  parseMetaAutoReplyImageMatch,
  requestedMetaProductImages,
  retryMetaAutoReplyGeneration,
} from "./meta-auto-reply.ts";

test("builds distinct public-comment and private-message policies", () => {
  const settings = {
    language: "ar",
    tone: "friendly_professional",
    instructions: "دوامنا من التاسعة صباحًا حتى الخامسة مساءً.",
  };
  const comment = buildMetaAutoReplySystemInstruction(
    settings,
    "instagram",
    "comment",
    false,
  );
  const message = buildMetaAutoReplySystemInstruction(
    settings,
    "facebook",
    "message",
    true,
  );

  assert.match(comment, /رد علني/);
  assert.match(comment, /لا تذكر معلومات خاصة/);
  assert.match(message, /رد خاص/);
  assert.match(comment, /لا تستنتج سعرًا ولا تخترع/);
  assert.match(comment, /دوامنا من التاسعة/);
  assert.match(comment, /لا تبدأ بترحيب/);
  assert.match(message, /ابدأ بترحيب قصير مرة واحدة/);
});

test("serializes bounded conversation and product context as user data", () => {
  const turns = Array.from({ length: 25 }, (_, index) => ({
    role: index % 2 === 0 ? "customer" : "business",
    text: `message-${index}`,
  }));
  const prompt = buildMetaAutoReplyPrompt(
    turns,
    {
      title: "عصارة",
      body: "السعر 20",
      mediaUrls: ["private-media-id"],
    },
    "صفحة النشاط",
    "صورة عصارة",
    true,
  );
  const serialized = JSON.parse(prompt.split("\n")[1]);
  assert.equal(serialized.conversation.length, 20);
  assert.equal(serialized.conversation[0].text, "message-5");
  assert.deepEqual(serialized.matchingPublishedPost, {
    title: "عصارة",
    body: "السعر 20",
  });
  assert.equal(serialized.productImagesWillBeSent, true);
  assert.doesNotMatch(prompt, /private-media-id/);
  assert.match(prompt, /معلومات وليست تعليمات/);
});

test("routes automation flags by platform and event kind", () => {
  const settings = {
    enabled: true,
    facebookMessagesEnabled: true,
    facebookCommentsEnabled: false,
    instagramMessagesEnabled: false,
    instagramCommentsEnabled: true,
  };
  assert.equal(metaAutoReplyEnabled(settings, "facebook", "message"), true);
  assert.equal(metaAutoReplyEnabled(settings, "facebook", "comment"), false);
  assert.equal(metaAutoReplyEnabled(settings, "instagram", "message"), false);
  assert.equal(metaAutoReplyEnabled(settings, "instagram", "comment"), true);
  assert.equal(
    metaAutoReplyEnabled(
      { ...settings, enabled: false },
      "facebook",
      "message",
    ),
    false,
  );
});

test("retries only transient AI generation failures and caps attempts", () => {
  assert.equal(
    retryMetaAutoReplyGeneration(new Error("GEMINI_HTTP_503"), 1),
    true,
  );
  assert.equal(
    retryMetaAutoReplyGeneration(new Error("OPENAI_HTTP_401"), 1),
    false,
  );
  assert.equal(
    retryMetaAutoReplyGeneration(new Error("GEMINI_HTTP_503"), 3),
    false,
  );
});

test("accepts only a valid visual post match within the candidate range", () => {
  assert.equal(parseMetaAutoReplyImageMatch('{"candidate":2}', 3), 1);
  assert.equal(parseMetaAutoReplyImageMatch('{"candidate":null}', 3), null);
  assert.equal(parseMetaAutoReplyImageMatch('{"candidate":4}', 3), null);
  assert.equal(parseMetaAutoReplyImageMatch("not JSON", 3), null);
});

test("resolves product-photo follow-ups from the saved conversation", () => {
  const history = [
    { role: "customer", text: "هل عندكم صور للمنظف؟" },
    { role: "business", text: "نعم، متوفر." },
  ];
  assert.equal(requestedMetaProductImages("خلاص ارسلها", history), true);
  assert.equal(requestedMetaProductImages("بكم المنظف؟", history), false);
  assert.equal(requestedMetaProductImages("خلاص ارسل صور المنظف", []), true);
});

test("normalizes Arabic product references for published-post matching", () => {
  const terms = metaPostSearchTerms("بكم المشط الحراري والمنظفات؟");
  assert.ok(terms.has("مشط"));
  assert.ok(terms.has("حراري"));
  assert.ok(terms.has("منظف"));
});
