import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaConnections,
  menaMetaWebhookSubscriptions,
} from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  metaPageAccessToken,
  MetaInboxGraphError,
  postMetaInboxGraph,
} from "../lib/meta-inbox-graph";
import {
  missingMetaIntegrationPermissions,
  type MetaIntegration,
} from "../lib/meta-oauth";

const router = Router();
const WEBHOOK_FIELDS: Record<MetaIntegration, string[]> = {
  facebook: ["feed", "messages", "messaging_postbacks"],
  instagram: ["comments", "messages"],
};

router.post(
  "/social/meta-inbox/webhook-subscriptions",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
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
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection) {
      res.status(409).json({ error: "اربط حساب Meta قبل تفعيل الوارد." });
      return;
    }

    const integrations: Array<{
      integration: MetaIntegration;
      accountId: string | null;
    }> = [
      { integration: "facebook", accountId: connection.pageId },
      {
        integration: "instagram",
        accountId: connection.instagramUserId,
      },
    ];
    const results: Record<
      string,
      { subscribed: boolean; fields: string[]; errorCode?: string }
    > = {};
    let tokenResult: Awaited<ReturnType<typeof metaPageAccessToken>>;
    try {
      tokenResult = await metaPageAccessToken(
        connection.encryptedPageAccessToken,
      );
    } catch {
      res.status(409).json({
        error: "تعذر فك رمز Meta. أعد ربط الحساب.",
        code: "META_TOKEN_UNAVAILABLE",
      });
      return;
    }

    for (const { integration, accountId } of integrations) {
      if (!accountId) continue;
      const fields = WEBHOOK_FIELDS[integration];
      const missing = missingMetaIntegrationPermissions(
        integration,
        connection.grantedPermissions,
      );
      if (missing.length > 0 || !connection.authorizationVerifiedAt) {
        const errorCode = "permissions_missing";
        results[integration] = { subscribed: false, fields, errorCode };
        await db
          .insert(menaMetaWebhookSubscriptions)
          .values({
            id: randomUUID(),
            ownerId,
            workspaceId,
            platform: integration,
            accountId,
            subscribedFields: fields,
            lastErrorCode: errorCode,
          })
          .onConflictDoUpdate({
            target: [
              menaMetaWebhookSubscriptions.workspaceId,
              menaMetaWebhookSubscriptions.platform,
            ],
            set: {
              accountId,
              subscribedFields: fields,
              subscribedAt: null,
              lastErrorCode: errorCode,
              updatedAt: new Date(),
            },
          });
        continue;
      }

      try {
        if (
          connection.accessTokenExpiresAt &&
          connection.accessTokenExpiresAt <= new Date()
        ) {
          throw new Error("token_expired");
        }
        if (tokenResult.rotatedCiphertext) {
          await db
            .update(menaMetaConnections)
            .set({
              encryptedPageAccessToken: tokenResult.rotatedCiphertext,
            })
            .where(
              and(
                eq(menaMetaConnections.workspaceId, workspaceId),
                eq(
                  menaMetaConnections.encryptedPageAccessToken,
                  connection.encryptedPageAccessToken,
                ),
              ),
            );
        }
        await postMetaInboxGraph(
          `${encodeURIComponent(accountId)}/subscribed_apps`,
          tokenResult.accessToken,
          { subscribed_fields: fields.join(",") },
        );
        results[integration] = { subscribed: true, fields };
        await db
          .insert(menaMetaWebhookSubscriptions)
          .values({
            id: randomUUID(),
            ownerId,
            workspaceId,
            platform: integration,
            accountId,
            subscribedFields: fields,
            subscribedAt: new Date(),
            lastErrorCode: null,
          })
          .onConflictDoUpdate({
            target: [
              menaMetaWebhookSubscriptions.workspaceId,
              menaMetaWebhookSubscriptions.platform,
            ],
            set: {
              accountId,
              subscribedFields: fields,
              subscribedAt: new Date(),
              lastErrorCode: null,
              updatedAt: new Date(),
            },
          });
      } catch (error) {
        const errorCode =
          error instanceof MetaInboxGraphError
            ? error.networkFailure
              ? "network_error"
              : `graph_${error.code ?? error.status ?? "error"}`
            : error instanceof Error && error.message === "token_expired"
              ? "token_expired"
              : "subscription_failed";
        results[integration] = { subscribed: false, fields, errorCode };
        await db
          .insert(menaMetaWebhookSubscriptions)
          .values({
            id: randomUUID(),
            ownerId,
            workspaceId,
            platform: integration,
            accountId,
            subscribedFields: fields,
            lastErrorCode: errorCode,
          })
          .onConflictDoUpdate({
            target: [
              menaMetaWebhookSubscriptions.workspaceId,
              menaMetaWebhookSubscriptions.platform,
            ],
            set: {
              accountId,
              subscribedFields: fields,
              subscribedAt: null,
              lastErrorCode: errorCode,
              updatedAt: new Date(),
            },
          });
      }
    }

    const statuses = Object.values(results);
    const failed = statuses.some((result) => !result.subscribed);
    const authorizationFailure = statuses.some((result) =>
      ["token_expired", "permissions_missing"].includes(result.errorCode ?? ""),
    );
    res
      .status(authorizationFailure ? 409 : failed ? 502 : 200)
      .json({ subscriptions: results });
  },
);

export default router;
