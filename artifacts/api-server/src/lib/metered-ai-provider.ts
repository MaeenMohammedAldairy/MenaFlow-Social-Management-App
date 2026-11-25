import {
  callAiProvider,
  type AiProviderCallOptions,
  type AiProviderOptions,
  type AiProviderResult,
} from "./ai-provider.ts";

/**
 * One text conversation, in both providers' shapes.
 *
 * Every feature that asks the model something in prose — the two automatic
 * replies and the Meta understanding step, product extraction with and without
 * images, the marketing draft, the writing assistant — hands the same pair to
 * OpenAI as two messages and to Gemini as a system instruction plus one user
 * turn. Seven call sites spelled that out separately, which is seven places
 * for the two providers to be told different things.
 *
 * It lives here rather than beside the provider because the lint rule keeps
 * `ai-provider.ts` closed to value imports: this module is the one every metered
 * caller already imports.
 */
export function textAiProviderOptions(input: {
  system: string;
  user: string;
}): Pick<
  AiProviderOptions,
  "openAiMessages" | "geminiContents" | "geminiSystemInstruction"
> {
  return {
    openAiMessages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    geminiContents: [{ parts: [{ text: input.user }] }],
    geminiSystemInstruction: input.system,
  };
}


export class SubscriptionAiQuotaError extends Error {
  readonly used: number;
  readonly limit: number;

  constructor(
    used: number,
    limit: number,
  ) {
    super("SUBSCRIPTION_LIMIT_REACHED:aiGenerations");
    this.name = "SubscriptionAiQuotaError";
    this.used = used;
    this.limit = limit;
  }
}

export async function callMeteredAiProvider(
  workspaceId: string,
  options: AiProviderCallOptions,
): Promise<AiProviderResult> {
  const { consumeSubscriptionUsage, releaseSubscriptionUsage } = await import(
    "./subscriptions.ts"
  );
  const quota = await consumeSubscriptionUsage(workspaceId, "aiGenerations");
  if (!quota.allowed) {
    throw new SubscriptionAiQuotaError(quota.used, quota.limit);
  }

  try {
    return await callAiProvider(options);
  } catch (error) {
    await releaseSubscriptionUsage(
      workspaceId,
      "aiGenerations",
      quota.periodKey,
    );
    throw error;
  }
}
