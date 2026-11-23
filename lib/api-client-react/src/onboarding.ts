import {
  completeSocialAccountsSetup,
  getGetOnboardingStatusQueryKey,
  updateOnboardingProgress as sendOnboardingProgress,
} from "./generated/api";
import type {
  OnboardingProgressInputAction,
  OnboardingStatus,
} from "./generated/api.schemas";

export type OnboardingAction = OnboardingProgressInputAction;

export function getOnboardingStatusQueryKey(userId: string | null) {
  return [...getGetOnboardingStatusQueryKey(), userId] as const;
}

export function saveOnboardingProgress(
  action: OnboardingAction,
  options?: Parameters<typeof sendOnboardingProgress>[1],
  expectedStep?: number,
): Promise<OnboardingStatus> {
  return sendOnboardingProgress({ action, ...(expectedStep === undefined ? {} : { expectedStep }) }, options);
}

export function markSocialAccountsSetupComplete(
  options?: Parameters<typeof completeSocialAccountsSetup>[0],
): Promise<OnboardingStatus> {
  return completeSocialAccountsSetup(options);
}
