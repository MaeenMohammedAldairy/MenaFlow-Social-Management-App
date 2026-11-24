/**
 * ai-provider-fallback.ts
 *
 * Pure decision helpers for the AI dispatch layer. Everything here is
 * deterministic and side-effect free so the provider order, throttle
 * cooldowns and per-purpose model pinning can be unit tested without
 * touching the network or the environment of the caller.
 *
 * Why this exists: every call used to try OpenAI first, eat a `429` (dead
 * latency of several seconds per call while the quota is exhausted) and then
 * fall back to Gemini. A short cooldown turns repeated quota errors into a
 * single skipped attempt instead of one per call, and model pinning keeps the
 * extraction quality stable instead of oscillating between models.
 */

export type AiProviderName = "openai" | "gemini";

/** Epoch milliseconds until which a provider must not be attempted. */
export type AiProviderCooldowns = Record<AiProviderName, number>;

export const emptyAiProviderCooldowns: AiProviderCooldowns = {
  openai: 0,
  gemini: 0,
};

export const DEFAULT_AI_PROVIDER_COOLDOWN_MS = 5 * 60_000;

export type AiProviderPlan = {
  /** Providers to try, in order. Empty means no provider is usable. */
  order: AiProviderName[];
  /** Providers that were left out, with the reason, for logging. */
  skipped: Array<{ provider: AiProviderName; reason: string }>;
};

/**
 * True when the failure means "asking again right now is pointless": quota or
 * rate limits, and credential/permission problems that will not heal on their
 * own within the cooldown window.
 */
export function isThrottledProviderReason(reason: string | undefined): boolean {
  if (!reason) return false;
  return /(?:^|_)(?:429|402)(?:$|[^0-9])/.test(reason) ||
    /^(?:OPENAI|GEMINI)_HTTP_4(?:01|03|29)$/.test(reason) ||
    reason.startsWith("SUBSCRIPTION_LIMIT_REACHED");
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Cooldown window for a throttle reason. Credential failures get a longer
 * window than plain rate limits because retrying them cannot succeed until an
 * operator changes the key.
 */
export function providerCooldownMs(
  reason: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const base = positiveInteger(
    env.AI_PROVIDER_COOLDOWN_MS,
    DEFAULT_AI_PROVIDER_COOLDOWN_MS,
  );
  if (!reason) return 0;
  if (/^(?:OPENAI|GEMINI)_HTTP_4(?:01|03)$/.test(reason)) {
    return positiveInteger(env.AI_PROVIDER_CREDENTIAL_COOLDOWN_MS, base * 6);
  }
  return isThrottledProviderReason(reason) ? base : 0;
}

/** Returns a new state; the input is never mutated. */
export function applyProviderCooldown(
  cooldowns: AiProviderCooldowns,
  provider: AiProviderName,
  reason: string | undefined,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): AiProviderCooldowns {
  const cooldownMs = providerCooldownMs(reason, env);
  if (cooldownMs <= 0) return cooldowns;
  const until = now + cooldownMs;
  return until > (cooldowns[provider] ?? 0)
    ? { ...cooldowns, [provider]: until }
    : cooldowns;
}

export function providerCooldownRemainingMs(
  cooldowns: AiProviderCooldowns,
  provider: AiProviderName,
  now: number,
): number {
  return Math.max(0, (cooldowns[provider] ?? 0) - now);
}

export function isProviderCoolingDown(
  cooldowns: AiProviderCooldowns,
  provider: AiProviderName,
  now: number,
): boolean {
  return providerCooldownRemainingMs(cooldowns, provider, now) > 0;
}

export type AiProviderAvailability = {
  openAiKeyPresent: boolean;
  geminiKeyPresent: boolean;
  preferredProvider?: AiProviderName;
  cooldowns: AiProviderCooldowns;
  now: number;
  /**
   * When true a cooling-down provider is still attempted. Used for an explicit
   * user-triggered retry, where failing loudly is better than silently using a
   * different model than the one the operator asked for.
   */
  ignoreCooldowns?: boolean;
};

/**
 * Ordered provider plan for one call. `preferredProvider` is absolute: it is
 * never replaced by the other provider, it is only skipped when it is cooling
 * down (and no key is missing), so callers see one clear error instead of a
 * surprise model.
 */
export function planAiProviders(input: AiProviderAvailability): AiProviderPlan {
  const skipped: AiProviderPlan["skipped"] = [];
  const keyPresent: Record<AiProviderName, boolean> = {
    openai: input.openAiKeyPresent,
    gemini: input.geminiKeyPresent,
  };

  const usable = (provider: AiProviderName): boolean => {
    if (!keyPresent[provider]) {
      skipped.push({ provider, reason: "MISSING_KEY" });
      return false;
    }
    if (!input.ignoreCooldowns && isProviderCoolingDown(input.cooldowns, provider, input.now)) {
      skipped.push({
        provider,
        reason: `COOLING_DOWN_${providerCooldownRemainingMs(input.cooldowns, provider, input.now)}`,
      });
      return false;
    }
    return true;
  };

  if (input.preferredProvider) {
    const preferred = input.preferredProvider;
    const other: AiProviderName = preferred === "openai" ? "gemini" : "openai";
    const order: AiProviderName[] = [];
    if (usable(preferred)) order.push(preferred);
    // A forced provider keeps the other one as a safety net only when the
    // forced one is unusable right now; the caller asked for quality, not for
    // a different model behind its back.
    if (order.length === 0 && usable(other)) order.push(other);
    return { order, skipped };
  }

  const order: AiProviderName[] = [];
  if (usable("openai")) order.push("openai");
  if (usable("gemini")) order.push("gemini");
  return { order, skipped };
}

export type AiModelOverrides = {
  openAiModel?: string;
  geminiModel?: string;
};

/**
 * Purpose-scoped model pinning. `AI_<PURPOSE>_OPENAI_MODEL` /
 * `AI_<PURPOSE>_GEMINI_MODEL` (purpose upper-cased, e.g. `EXTRACTION`) win
 * over the global `OPENAI_MODEL` / `GEMINI_MODEL`, which the provider layer
 * still applies as the default. Values are passed through untouched here;
 * `validateModelName` in the dispatch layer rejects anything unsafe.
 */
export function resolvePurposeModelOverrides(
  purpose: string,
  env: NodeJS.ProcessEnv = process.env,
): AiModelOverrides {
  const key = purpose.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (!key) return {};
  const openAiModel = env[`AI_${key}_OPENAI_MODEL`]?.trim();
  const geminiModel = env[`AI_${key}_GEMINI_MODEL`]?.trim();
  return {
    ...(openAiModel ? { openAiModel } : {}),
    ...(geminiModel ? { geminiModel } : {}),
  };
}

/** Human-readable summary of a plan, safe to log. */
export function describeAiProviderPlan(plan: AiProviderPlan): string {
  const attempted = plan.order.length ? plan.order.join("->") : "none";
  const skipped = plan.skipped.length
    ? plan.skipped.map((item) => `${item.provider}:${item.reason}`).join(",")
    : "none";
  return `attempted=${attempted} skipped=${skipped}`;
}
