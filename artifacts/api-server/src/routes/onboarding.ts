import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  GetOnboardingStatusResponse,
  UpdateOnboardingProgressBody,
  UpdateOnboardingProgressResponse,
} from "@workspace/api-zod";
import { db, workspaceOnboarding } from "@workspace/db";
import { transitionOnboardingProgress } from "../lib/onboarding-progress";
import {
  requireWorkspace,
  requestWorkspaceId,
  requestWorkspaceUserId,
} from "../lib/workspace-context";

const router = Router();

router.get("/onboarding", requireWorkspace, async (req, res, next) => {
  try {
    const [progress] = await db
      .select({
        step: workspaceOnboarding.currentStep,
        completed: workspaceOnboarding.completed,
        socialAccountsCompleted:
          workspaceOnboarding.socialAccountsCompleted,
      })
      .from(workspaceOnboarding)
      .where(
        and(
          eq(workspaceOnboarding.workspaceId, requestWorkspaceId(req)),
          eq(workspaceOnboarding.userId, requestWorkspaceUserId(req)),
        ),
      )
      .limit(1);

    res.json(
      GetOnboardingStatusResponse.parse({
        started: progress ? !progress.completed : false,
        currentStep: progress?.step ?? 3,
        completed: progress?.completed ?? true,
        socialAccountsCompleted: progress?.socialAccountsCompleted ?? true,
      }),
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
    const { action } = input.data;

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
          };
        }

        const next = transitionOnboardingProgress(current, action);
        if (
          next.step === current.step &&
          next.completed === current.completed
        ) {
          return { ...current, ...next };
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

        return updated ?? null;
      });

      if (!progress) {
        res.status(409).json({ error: "تعذر العثور على تقدم الجولة التعريفية." });
        return;
      }

      res.json(
        UpdateOnboardingProgressResponse.parse({
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

router.post(
  "/onboarding/social-accounts/complete",
  requireWorkspace,
  async (req, res, next) => {
    try {
      const workspaceId = requestWorkspaceId(req);
      const userId = requestWorkspaceUserId(req);
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
