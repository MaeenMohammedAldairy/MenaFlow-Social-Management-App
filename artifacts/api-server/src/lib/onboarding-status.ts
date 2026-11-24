import { and, eq } from "drizzle-orm";
import {
  GetOnboardingStatusResponse,
  hasEligibleSocialConnection,
} from "@workspace/api-zod";
import {
  db,
  menaMetaConnections,
  menaWhatsAppConnections,
  workspaceOnboarding,
} from "@workspace/db";
import { metaAuthorizationStatus } from "./meta-oauth";

/**
 * Whether the workspace currently holds an account that can publish or reply.
 *
 * Derived from the live connection rows instead of the stored
 * `workspace_onboarding.social_accounts_completed` column. That column is only
 * ever written as `true` (by `POST /onboarding/social-accounts/complete`) and
 * never reset, so it kept answering "done" after a merchant disconnected their
 * last account — the dashboard told them to link one while the setup screen
 * reported the accounts step complete.
 *
 * Deliberately database-only: no provider call. WhatsApp counts when its stored
 * status is `connected`, which is the same signal the rest of the app reads.
 */
export async function socialAccountsCompletedForWorkspace(
  workspaceId: string,
): Promise<boolean> {
  const [meta] = await db
    .select({
      authorizationVerifiedAt: menaMetaConnections.authorizationVerifiedAt,
      accessTokenExpiresAt: menaMetaConnections.accessTokenExpiresAt,
      grantedPermissions: menaMetaConnections.grantedPermissions,
      instagramUserId: menaMetaConnections.instagramUserId,
      instagramUsername: menaMetaConnections.instagramUsername,
    })
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);

  const [whatsapp] = await db
    .select({ status: menaWhatsAppConnections.status })
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
    .limit(1);

  const now = new Date();
  return hasEligibleSocialConnection({
    facebook: meta
      ? {
          authorizationStatus: metaAuthorizationStatus(
            meta,
            "facebook",
            now,
          ).authorizationStatus,
        }
      : null,
    instagram:
      meta?.instagramUserId && meta.instagramUsername
        ? {
            authorizationStatus: metaAuthorizationStatus(
              meta,
              "instagram",
              now,
            ).authorizationStatus,
          }
        : null,
    whatsapp:
      whatsapp?.status === "connected"
        ? { connectionState: "connected" }
        : null,
  });
}

export async function getWorkspaceOnboardingStatus(
  workspaceId: string,
  userId: string,
) {
  const [progress] = await db
    .select({
      step: workspaceOnboarding.currentStep,
      completed: workspaceOnboarding.completed,
    })
    .from(workspaceOnboarding)
    .where(
      and(
        eq(workspaceOnboarding.workspaceId, workspaceId),
        eq(workspaceOnboarding.userId, userId),
      ),
    )
    .limit(1);
  const socialAccountsCompleted =
    await socialAccountsCompletedForWorkspace(workspaceId);

  return GetOnboardingStatusResponse.parse({
    started: progress ? !progress.completed : false,
    currentStep: progress?.step ?? 3,
    completed: progress?.completed ?? true,
    socialAccountsCompleted,
  });
}
