import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AI_PROVIDER_COOLDOWN_MS,
  applyProviderCooldown,
  describeAiProviderPlan,
  emptyAiProviderCooldowns,
  isProviderCoolingDown,
  isThrottledProviderReason,
  planAiProviders,
  providerCooldownMs,
  providerCooldownRemainingMs,
  resolvePurposeModelOverrides,
} from "./ai-provider-fallback.ts";

const now = Date.parse("2026-11-24T03:00:00.000Z");

test("quota and credential failures are throttled, transient ones are not", () => {
  assert.equal(isThrottledProviderReason("OPENAI_HTTP_429"), true);
  assert.equal(isThrottledProviderReason("GEMINI_HTTP_429"), true);
  assert.equal(isThrottledProviderReason("OPENAI_HTTP_401"), true);
  assert.equal(isThrottledProviderReason("SUBSCRIPTION_LIMIT_REACHED:aiGenerations"), true);
  assert.equal(isThrottledProviderReason("OPENAI_HTTP_500"), false);
  assert.equal(isThrottledProviderReason("GEMINI_EMPTY_RESPONSE"), false);
  assert.equal(isThrottledProviderReason(undefined), false);
});

test("cooldown length follows the configured window and is longer for bad credentials", () => {
  assert.equal(providerCooldownMs("OPENAI_HTTP_429", {}), DEFAULT_AI_PROVIDER_COOLDOWN_MS);
  assert.equal(providerCooldownMs("OPENAI_HTTP_429", { AI_PROVIDER_COOLDOWN_MS: "60000" }), 60_000);
  assert.equal(providerCooldownMs("OPENAI_HTTP_401", { AI_PROVIDER_COOLDOWN_MS: "60000" }), 360_000);
  assert.equal(providerCooldownMs("GEMINI_HTTP_500", {}), 0);
  assert.equal(providerCooldownMs("OPENAI_HTTP_429", { AI_PROVIDER_COOLDOWN_MS: "abc" }), DEFAULT_AI_PROVIDER_COOLDOWN_MS);
});

test("applying a cooldown never mutates the input state and never shortens a window", () => {
  const cooled = applyProviderCooldown(emptyAiProviderCooldowns, "openai", "OPENAI_HTTP_429", now, {});
  assert.deepEqual(emptyAiProviderCooldowns, { openai: 0, gemini: 0 });
  assert.equal(cooled.openai, now + DEFAULT_AI_PROVIDER_COOLDOWN_MS);
  assert.equal(isProviderCoolingDown(cooled, "openai", now), true);
  assert.equal(isProviderCoolingDown(cooled, "gemini", now), false);
  assert.equal(
    providerCooldownRemainingMs(cooled, "openai", now + 60_000),
    DEFAULT_AI_PROVIDER_COOLDOWN_MS - 60_000,
  );

  const shorter = applyProviderCooldown(cooled, "openai", "OPENAI_HTTP_429", now + 1000, {
    AI_PROVIDER_COOLDOWN_MS: "1000",
  });
  assert.equal(shorter.openai, cooled.openai);

  const unrelated = applyProviderCooldown(cooled, "openai", "OPENAI_HTTP_500", now, {});
  assert.deepEqual(unrelated, cooled);
});

test("the plan tries OpenAI first and Gemini second when both are usable", () => {
  const plan = planAiProviders({
    openAiKeyPresent: true,
    geminiKeyPresent: true,
    cooldowns: emptyAiProviderCooldowns,
    now,
  });
  assert.deepEqual(plan.order, ["openai", "gemini"]);
  assert.deepEqual(plan.skipped, []);
});

test("a cooling-down OpenAI is skipped without burning a request", () => {
  const cooldowns = applyProviderCooldown(emptyAiProviderCooldowns, "openai", "OPENAI_HTTP_429", now, {});
  const plan = planAiProviders({
    openAiKeyPresent: true,
    geminiKeyPresent: true,
    cooldowns,
    now: now + 1000,
  });
  assert.deepEqual(plan.order, ["gemini"]);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].provider, "openai");
  assert.match(plan.skipped[0].reason, /^COOLING_DOWN_\d+$/);
  assert.match(describeAiProviderPlan(plan), /attempted=gemini skipped=openai:COOLING_DOWN_/);
});

test("an explicit retry ignores the cooldown window", () => {
  const cooldowns = applyProviderCooldown(emptyAiProviderCooldowns, "openai", "OPENAI_HTTP_429", now, {});
  const plan = planAiProviders({
    openAiKeyPresent: true,
    geminiKeyPresent: true,
    cooldowns,
    now: now + 1000,
    ignoreCooldowns: true,
  });
  assert.deepEqual(plan.order, ["openai", "gemini"]);
});

test("a preferred provider is not silently replaced while it is usable", () => {
  const plan = planAiProviders({
    openAiKeyPresent: true,
    geminiKeyPresent: true,
    preferredProvider: "gemini",
    cooldowns: emptyAiProviderCooldowns,
    now,
  });
  assert.deepEqual(plan.order, ["gemini"]);
});

test("a preferred provider that is cooling down falls back once", () => {
  const cooldowns = applyProviderCooldown(emptyAiProviderCooldowns, "gemini", "GEMINI_HTTP_429", now, {});
  const plan = planAiProviders({
    openAiKeyPresent: true,
    geminiKeyPresent: true,
    preferredProvider: "gemini",
    cooldowns,
    now: now + 1000,
  });
  assert.deepEqual(plan.order, ["openai"]);
});

test("missing keys are reported instead of producing an empty silent plan", () => {
  const plan = planAiProviders({
    openAiKeyPresent: false,
    geminiKeyPresent: false,
    cooldowns: emptyAiProviderCooldowns,
    now,
  });
  assert.deepEqual(plan.order, []);
  assert.deepEqual(plan.skipped.map((item) => item.reason), ["MISSING_KEY", "MISSING_KEY"]);
  assert.equal(describeAiProviderPlan(plan), "attempted=none skipped=openai:MISSING_KEY,gemini:MISSING_KEY");
});

test("purpose model overrides beat the global defaults and are opt-in", () => {
  assert.deepEqual(resolvePurposeModelOverrides("extraction", {}), {});
  assert.deepEqual(
    resolvePurposeModelOverrides("extraction", {
      AI_EXTRACTION_GEMINI_MODEL: "gemini-2.5-pro",
      OPENAI_MODEL: "gpt-4o-mini",
    }),
    { geminiModel: "gemini-2.5-pro" },
  );
  assert.deepEqual(
    resolvePurposeModelOverrides("vision extraction", {
      AI_VISION_EXTRACTION_OPENAI_MODEL: " gpt-4o ",
      AI_VISION_EXTRACTION_GEMINI_MODEL: "gemini-2.5-flash",
    }),
    { openAiModel: "gpt-4o", geminiModel: "gemini-2.5-flash" },
  );
});
