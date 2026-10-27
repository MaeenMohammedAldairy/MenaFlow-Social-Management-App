import assert from "node:assert/strict";
import test from "node:test";
import { transitionOnboardingProgress } from "./onboarding-progress.ts";

test("advances the tour and completes it after the third slide", () => {
  const second = transitionOnboardingProgress(
    { step: 0, completed: false },
    "advance",
  );
  const third = transitionOnboardingProgress(second, "advance");
  const complete = transitionOnboardingProgress(third, "advance");

  assert.deepEqual(second, { step: 1, completed: false });
  assert.deepEqual(third, { step: 2, completed: false });
  assert.deepEqual(complete, { step: 3, completed: true });
});

test("allows going back without losing completion state", () => {
  assert.deepEqual(
    transitionOnboardingProgress({ step: 2, completed: false }, "back"),
    { step: 1, completed: false },
  );
  assert.deepEqual(
    transitionOnboardingProgress({ step: 0, completed: false }, "back"),
    { step: 0, completed: false },
  );
});

test("skip completes the tour from every slide and completed tours stay complete", () => {
  for (const step of [0, 1, 2]) {
    const skipped = transitionOnboardingProgress(
      { step, completed: false },
      "skip",
    );
    assert.deepEqual(skipped, { step: 3, completed: true });
    assert.deepEqual(transitionOnboardingProgress(skipped, "back"), {
      step: 3,
      completed: true,
    });
  }
});
