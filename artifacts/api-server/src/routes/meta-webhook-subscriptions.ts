import { eq } from "drizzle-orm";
import { Router } from "express";
import { db, menaMetaConnections } from "@workspace/db";
import { activateMetaWebhookSubscriptionsForConnection } from "../lib/meta-webhook-subscriptions";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();

router.post(
  "/social/meta-inbox/webhook-subscriptions",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    if (!process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim()) {
      res.status(503).json({
        error:
          "اضبط MENA_META_WEBHOOK_VERIFY_TOKEN في الخادم وأعد تشغيله قبل تفعيل استقبال الأحداث.",
        code: "META_WEBHOOK_NOT_CONFIGURED",
      });
      return;
    }

    const [connection] = await db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, requestWorkspaceId(req)))
      .limit(1);
    if (!connection) {
      res.status(409).json({ error: "اربط حساب Meta قبل تفعيل الوارد." });
      return;
    }
    if (
      !connection.authorizationVerifiedAt ||
      (connection.accessTokenExpiresAt &&
        connection.accessTokenExpiresAt <= new Date())
    ) {
      res.status(409).json({
        error: "رمز Meta غير صالح أو منتهي. أعد تفويض الحساب قبل تفعيل الوارد.",
        code: "META_REAUTH_REQUIRED",
      });
      return;
    }

    const subscriptions =
      await activateMetaWebhookSubscriptionsForConnection(connection);
    const statuses = Object.values(subscriptions);
    const failed = statuses.some((result) => !result.subscribed);
    const authorizationFailure = statuses.some((result) =>
      ["token_expired", "token_invalid", "permissions_missing"].includes(
        result.errorCode ?? "",
      ),
    );
    res
      .status(authorizationFailure ? 409 : failed ? 502 : 200)
      .json({ subscriptions });
  },
);

export default router;
