import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  GetOnboardingStatusResponse,
  UpdateOnboardingProgressBody,
  UpdateOnboardingProgressResponse,
  hasEligibleSocialConnection,
  type EligibleSocialConnections,
} from "@workspace/api-zod";
import {
  db,
  menaMetaConnections,
  menaWhatsAppConnections,
  workspaceOnboarding,
} from "@workspace/db";
import { metaAuthorizationStatus } from "../lib/meta-oauth";
import { transitionOnboardingProgress } from "../lib/onboarding-progress";
import {
  getWorkspaceOnboardingStatus,
  socialAccountsCompletedForWorkspace,
} from "../lib/onboarding-status";
import {
  EvolutionApiError,
  evolutionConnectionState,
} from "../lib/whatsapp-evolution";
import {
  requireWorkspace,
  requestWorkspaceId,
  requestWorkspaceUserId,
} from "../lib/workspace-context";
import { logger } from "../lib/logger.ts";

const router = Router();

router.get("/onboarding", requireWorkspace, async (req, res, next) => {
  try {
    res.json(
      await getWorkspaceOnboardingStatus(
        requestWorkspaceId(req),
        requestWorkspaceUserId(req),
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.post(
  "/onboarding/progress",
  requireWorkspace,
  async (req, res, next) => {
    const input = UpdateOnboardingProgressBody.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "إجراء التقدم غير صالح." });
      return;
    }
    const { action, expectedStep } = input.data;

    try {
      const workspaceId = requestWorkspaceId(req);
      const progress = await db.transaction(async (transaction) => {
        const [current] = await transaction
          .select({
            step: workspaceOnboarding.currentStep,
            completed: workspaceOnboarding.completed,
            socialAccountsCompleted:
              workspaceOnboarding.socialAccountsCompleted,
          })
          .from(workspaceOnboarding)
          .where(
            and(
              eq(workspaceOnboarding.workspaceId, workspaceId),
              eq(workspaceOnboarding.userId, requestWorkspaceUserId(req)),
            ),
          )
          .for("update")
          .limit(1);

        if (!current) {
          return {
            step: 3,
            completed: true,
            socialAccountsCompleted: true,
            changed: false,
          };
        }

        const next = transitionOnboardingProgress(current, action, expectedStep);
        if (
          next.step === current.step &&
          next.completed === current.completed
        ) {
          return { ...current, ...next, changed: false };
        }

        const [updated] = await transaction
          .update(workspaceOnboarding)
          .set({
            currentStep: next.step,
            completed: next.completed,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaceOnboarding.workspaceId, workspaceId),
              eq(workspaceOnboarding.userId, requestWorkspaceUserId(req)),
            ),
          )
          .returning({
            step: workspaceOnboarding.currentStep,
            completed: workspaceOnboarding.completed,
            socialAccountsCompleted:
              workspaceOnboarding.socialAccountsCompleted,
          });

        return updated ? { ...updated, changed: true } : null;
      });

      if (!progress) {
        res.status(409).json({ error: "تعذر العثور على تقدم الجولة التعريفية." });
        return;
      }

      if (progress.changed) {
        // Aggregate funnel metrics without names, account identifiers or tokens.
        logger.info({ event: "onboarding_progress", action, step: progress.step, completed: progress.completed }, "Onboarding progress changed");
      }
      res.json(
        UpdateOnboardingProgressResponse.parse({
          started: !progress.completed,
          currentStep: progress.step,
          completed: progress.completed,
          socialAccountsCompleted:
            await socialAccountsCompletedForWorkspace(workspaceId),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/onboarding/social-accounts/complete",
  requireWorkspace,
  async (req, res, next) => {
    try {
      const workspaceId = requestWorkspaceId(req);
      const userId = requestWorkspaceUserId(req);
      const [metaConnection] = await db
        .select()
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      const now = new Date();
      const facebook = metaConnection
        ? {
            authorizationStatus: metaAuthorizationStatus(
              metaConnection,
              "facebook",
              now,
            ).authorizationStatus,
          }
        : null;
      const instagram =
        metaConnection?.instagramUserId && metaConnection.instagramUsername
          ? {
              authorizationStatus: metaAuthorizationStatus(
                metaConnection,
                "instagram",
                now,
              ).authorizationStatus,
            }
          : null;
      let eligibleConnections: EligibleSocialConnections = {
        facebook,
        instagram,
        whatsapp: null,
      };
      if (!hasEligibleSocialConnection(eligibleConnections)) {
        const [whatsappConnection] = await db
          .select()
          .from(menaWhatsAppConnections)
          .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
          .limit(1);
        if (whatsappConnection) {
          let whatsappState: string;
          try {
            whatsappState = await evolutionConnectionState(
              whatsappConnection.instanceName,
            );
          } catch (error) {
            if (
              error instanceof EvolutionApiError &&
              error.statusCode === 404
            ) {
              whatsappState = "missing";
            } else {
              logger.warn(
                {
                  workspaceId,
                  statusCode:
                    error instanceof EvolutionApiError
                      ? error.statusCode
                      : null,
                },
                "Unable to verify WhatsApp for onboarding completion",
              );
              res.status(503).json({
                error:
                  "تعذر التحقق من اتصال WhatsApp الآن. حاول مرة أخرى بعد استقرار الخدمة.",
              });
              return;
            }
          }
          if (
            whatsappState === "open" &&
            whatsappConnection.status !== "connected"
          ) {
            await db
              .update(menaWhatsAppConnections)
              .set({ status: "connected", connectedAt: now })
              .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
          }
          eligibleConnections = {
            ...eligibleConnections,
            whatsapp: {
              connectionState:
                whatsappState === "open" ? "connected" : whatsappState,
            },
          };
        }
      }
      if (!hasEligibleSocialConnection(eligibleConnections)) {
        res.status(409).json({
          error:
            "اربط حساب Facebook أو Instagram بصلاحيات صالحة، أو حساب WhatsApp متصلًا، قبل إكمال الإعداد.",
        });
        return;
      }

      const [progress] = await db
        .update(workspaceOnboarding)
        .set({
          socialAccountsCompleted: true,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaceOnboarding.workspaceId, workspaceId),
            eq(workspaceOnboarding.userId, userId),
            eq(workspaceOnboarding.completed, true),
          ),
        )
        .returning({
          step: workspaceOnboarding.currentStep,
          completed: workspaceOnboarding.completed,
          socialAccountsCompleted:
            workspaceOnboarding.socialAccountsCompleted,
        });

      if (!progress) {
        res.status(409).json({ error: "تعذر العثور على إعداد مساحة العمل." });
        return;
      }

      res.json(
        GetOnboardingStatusResponse.parse({
          started: !progress.completed,
          currentStep: progress.step,
          completed: progress.completed,
          socialAccountsCompleted: progress.socialAccountsCompleted,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

export default router;
