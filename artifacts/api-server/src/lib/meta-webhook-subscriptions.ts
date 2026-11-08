import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  gt,
  isNotNull,
  notExists,
  or,
} from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaMetaWebhookSubscriptions,
} from "@workspace/db";
import { logger } from "./logger";
import {
  metaPageAccessToken,
  MetaInboxGraphError,
  postMetaInboxGraph,
} from "./meta-inbox-graph";
import {
  missingMetaIntegrationPermissions,
  type MetaIntegration,
} from "./meta-oauth";

const webhookFields: Record<MetaIntegration, string[]> = {
  facebook: ["feed", "messages", "messaging_postbacks"],
  instagram: ["comments", "messages"],
};

type MetaConnection = typeof menaMetaConnections.$inferSelect;

export type MetaWebhookSubscriptionResult = {
  subscribed: boolean;
  fields: string[];
  errorCode?: string;
};

export type MetaWebhookSubscriptionResults = Partial<
  Record<MetaIntegration, MetaWebhookSubscriptionResult>
>;

async function saveSubscriptionResult(input: {
  ownerId: string;
  workspaceId: string;
  platform: MetaIntegration;
  accountId: string;
  result: MetaWebhookSubscriptionResult;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(menaMetaWebhookSubscriptions)
    .values({
      id: randomUUID(),
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
      platform: input.platform,
      accountId: input.accountId,
      subscribedFields: input.result.fields,
      subscribedAt: input.result.subscribed ? now : null,
      lastErrorCode: input.result.errorCode ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        menaMetaWebhookSubscriptions.workspaceId,
        menaMetaWebhookSubscriptions.platform,
      ],
      set: {
        accountId: input.accountId,
        subscribedFields: input.result.fields,
        subscribedAt: input.result.subscribed ? now : null,
        lastErrorCode: input.result.errorCode ?? null,
        updatedAt: now,
      },
    });
}

function failureCode(error: unknown): string {
  if (error instanceof MetaInboxGraphError) {
    return error.networkFailure
      ? "network_error"
      : `graph_${error.code ?? error.status ?? "error"}`;
  }
  if (error instanceof Error && error.message === "token_expired") {
    return "token_expired";
  }
  return "subscription_failed";
}

async function saveFailureForConnection(
  connection: MetaConnection,
  platform: MetaIntegration,
  accountId: string | null,
  errorCode: string,
): Promise<MetaWebhookSubscriptionResult | null> {
  if (!accountId) return null;
  const result = {
    subscribed: false,
    fields: webhookFields[platform],
    errorCode,
  };
  await saveSubscriptionResult({
    ownerId: connection.ownerId,
    workspaceId: connection.workspaceId,
    platform,
    accountId,
    result,
  });
  logger.warn(
    { workspaceId: connection.workspaceId, platform, errorCode },
    "Meta webhook subscription is not ready",
  );
  return result;
}

export async function activateMetaWebhookSubscriptionsForConnection(
  connection: MetaConnection,
): Promise<MetaWebhookSubscriptionResults> {
  const accounts = [
    { platform: "facebook" as const, accountId: connection.pageId },
    { platform: "instagram" as const, accountId: connection.instagramUserId },
  ];
  const results: MetaWebhookSubscriptionResults = {};

  if (!process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim()) {
    for (const { platform, accountId } of accounts) {
      const result = await saveFailureForConnection(
        connection,
        platform,
        accountId,
        "webhook_not_configured",
      );
      if (result) results[platform] = result;
    }
    return results;
  }

  let tokenResult: Awaited<ReturnType<typeof metaPageAccessToken>>;
  try {
    tokenResult = await metaPageAccessToken(
      connection.encryptedPageAccessToken,
    );
  } catch {
    for (const { platform, accountId } of accounts) {
      const result = await saveFailureForConnection(
        connection,
        platform,
        accountId,
        "token_unavailable",
      );
      if (result) results[platform] = result;
    }
    return results;
  }

  if (tokenResult.rotatedCiphertext) {
    await db
      .update(menaMetaConnections)
      .set({ encryptedPageAccessToken: tokenResult.rotatedCiphertext })
      .where(
        and(
          eq(menaMetaConnections.workspaceId, connection.workspaceId),
          eq(
            menaMetaConnections.encryptedPageAccessToken,
            connection.encryptedPageAccessToken,
          ),
        ),
      );
  }

  for (const { platform, accountId } of accounts) {
    if (!accountId) continue;
    const fields = webhookFields[platform];
    const missingPermissions = missingMetaIntegrationPermissions(
      platform,
      connection.grantedPermissions,
    );
    if (missingPermissions.length > 0 || !connection.authorizationVerifiedAt) {
      const result = await saveFailureForConnection(
        connection,
        platform,
        accountId,
        "permissions_missing",
      );
      if (result) results[platform] = result;
      continue;
    }

    try {
      if (
        connection.accessTokenExpiresAt &&
        connection.accessTokenExpiresAt <= new Date()
      ) {
        throw new Error("token_expired");
      }
      await postMetaInboxGraph(
        `${encodeURIComponent(accountId)}/subscribed_apps`,
        tokenResult.accessToken,
        { subscribed_fields: fields.join(",") },
      );
      const result = { subscribed: true, fields };
      await saveSubscriptionResult({
        ownerId: connection.ownerId,
        workspaceId: connection.workspaceId,
        platform,
        accountId,
        result,
      });
      results[platform] = result;
    } catch (error) {
      const errorCode = failureCode(error);
      const result = await saveFailureForConnection(
        connection,
        platform,
        accountId,
        errorCode,
      );
      if (result) results[platform] = result;
    }
  }
  return results;
}

let reconciliationRunning = false;

function needsSubscriptionRetry(
  platform: MetaIntegration,
  accountId: typeof menaMetaConnections.pageId | typeof menaMetaConnections.instagramUserId,
  retryBefore: Date,
 ) {
  const currentSubscription = db
    .select({ id: menaMetaWebhookSubscriptions.id })
    .from(menaMetaWebhookSubscriptions)
    .where(
      and(
        eq(
          menaMetaWebhookSubscriptions.workspaceId,
          menaMetaConnections.workspaceId,
        ),
        eq(menaMetaWebhookSubscriptions.platform, platform),
        eq(menaMetaWebhookSubscriptions.accountId, accountId),
        isNotNull(menaMetaWebhookSubscriptions.subscribedAt),
      ),
    );
  const recentFailure = db
    .select({ id: menaMetaWebhookSubscriptions.id })
    .from(menaMetaWebhookSubscriptions)
    .where(
      and(
        eq(
          menaMetaWebhookSubscriptions.workspaceId,
          menaMetaConnections.workspaceId,
        ),
        eq(menaMetaWebhookSubscriptions.platform, platform),
        eq(menaMetaWebhookSubscriptions.accountId, accountId),
        isNotNull(menaMetaWebhookSubscriptions.lastErrorCode),
        gt(menaMetaWebhookSubscriptions.updatedAt, retryBefore),
      ),
    );
  return and(notExists(currentSubscription), notExists(recentFailure));
}

export async function processMetaWebhookSubscriptionQueue(): Promise<void> {
  if (reconciliationRunning || !process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim()) {
    return;
  }
  reconciliationRunning = true;
  try {
    const retryBefore = new Date(Date.now() - 5 * 60_000);
    const connections = await db.select().from(menaMetaConnections).where(
      or(
        and(
          isNotNull(menaMetaConnections.pageId),
          needsSubscriptionRetry(
            "facebook",
            menaMetaConnections.pageId,
            retryBefore,
          ),
        ),
        and(
          isNotNull(menaMetaConnections.instagramUserId),
          needsSubscriptionRetry(
            "instagram",
            menaMetaConnections.instagramUserId,
            retryBefore,
          ),
        ),
      ),
    ).limit(25);
    for (const connection of connections) {
      await activateMetaWebhookSubscriptionsForConnection(connection);
    }
  } finally {
    reconciliationRunning = false;
  }
}
