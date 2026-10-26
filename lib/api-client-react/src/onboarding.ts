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
): Promise<OnboardingStatus> {
  return sendOnboardingProgress({ action });
}

export function markSocialAccountsSetupComplete(): Promise<OnboardingStatus> {
  return completeSocialAccountsSetup();
}
