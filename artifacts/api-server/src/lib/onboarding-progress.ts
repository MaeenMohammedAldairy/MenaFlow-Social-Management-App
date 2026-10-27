export type OnboardingAction = "advance" | "back" | "skip";

export interface OnboardingProgress {
  step: number;
  completed: boolean;
}

export function transitionOnboardingProgress(
  current: OnboardingProgress,
  action: OnboardingAction,
): OnboardingProgress {
  if (current.completed) return current;
  if (action === "skip") return { step: 3, completed: true };
  if (action === "back") {
    return { step: Math.max(0, current.step - 1), completed: false };
  }

  const step = Math.min(3, current.step + 1);
  return { step, completed: step === 3 };
}
