import {
  callAiProvider,
  type AiProviderOptions,
  type AiProviderResult,
} from "./ai-provider.ts";

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
  options: AiProviderOptions & { preferredProvider?: "openai" | "gemini" },
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
