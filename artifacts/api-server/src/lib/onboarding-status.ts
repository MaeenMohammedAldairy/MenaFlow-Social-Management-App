import { and, eq } from "drizzle-orm";
import { GetOnboardingStatusResponse } from "@workspace/api-zod";
import { db, workspaceOnboarding } from "@workspace/db";

export async function getWorkspaceOnboardingStatus(
  workspaceId: string,
  userId: string,
) {
  const [progress] = await db
    .select({
      step: workspaceOnboarding.currentStep,
      completed: workspaceOnboarding.completed,
      socialAccountsCompleted: workspaceOnboarding.socialAccountsCompleted,
    })
    .from(workspaceOnboarding)
    .where(
      and(
        eq(workspaceOnboarding.workspaceId, workspaceId),
        eq(workspaceOnboarding.userId, userId),
      ),
    )
    .limit(1);

  return GetOnboardingStatusResponse.parse({
    started: progress ? !progress.completed : false,
    currentStep: progress?.step ?? 3,
    completed: progress?.completed ?? true,
    socialAccountsCompleted: progress?.socialAccountsCompleted ?? true,
  });
}