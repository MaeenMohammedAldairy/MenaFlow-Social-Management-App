import { and, asc, eq, lt, ne, sql } from "drizzle-orm";
import {
  db,
  menaContentJobs,
  menaContentSettings,
  menaInventoryMovements,
  menaMetaAutoReplyJobs,
  menaMetaAutoReplySettings,
  menaMetaConnections,
  menaMetaInboxItems,
  menaMetaOrderIntakes,
  menaMetaWebhookSubscriptions,
  menaOAuthStates,
  menaOrderDeliveryEvents,
  menaOrderEvents,
  menaOrderItems,
  menaOrders,
  menaPostActivityEvents,
  menaWhatsAppAutoReplyEvents,
  menaWhatsAppConnections,
  menaWhatsAppContentAssociations,
  menaWhatsAppDirectMessages,
  menaWhatsAppGroupJids,
  menaWhatsAppGroupSelections,
  menaWhatsAppGroups,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  menaWhatsAppOrderIntakes,
  menaWhatsAppSyncStates,
  posts,
  productExtractionSources,
  productExtractionSuggestions,
  productPosts,
  productPublicationJobs,
  products,
  pushNotificationOutbox,
  whatsappProductExtractionJobs,
  workspaceDeletionRequests,
  workspaceMembers,
  workspaceOnboarding,
  workspaceSubscriptionUsage,
  workspaceSubscriptions,
  workspaces,
} from "@workspace/db";
import { EvolutionApiError, clearConnectionStateCache, evolutionRequest } from "./whatsapp-evolution";
import { deleteMediaObjectsByPrefixes } from "./whatsapp-media-storage";
import { decryptMetaToken } from "./meta-token-crypto";
import { getMetaGraphVersion } from "./meta-graph-config";
import {
  DELETION_GRACE_MS,
  DELETION_MAX_ATTEMPTS,
  deletionDueCutoff,
  workspaceStoragePrefixes,
} from "./workspace-deletion-policy";
import { logger } from "./logger";

/**
 * The workspace-deletion worker (§3.4 of the audit).
 *
 * Before this existed, `POST /workspaces/current/deletion-request` recorded a
 * row and nothing ever processed it — the merchant saw "request recorded"
 * while every byte of their data (including WhatsApp media in Supabase
 * Storage) stayed alive. That is a compliance failure, not a missing feature.
 *
 * Pipeline per due request (30-day grace, then):
 *   1. Meta: best-effort unsubscribe of the page's webhook (graph DELETE
 *      `{page-id}/subscribed_apps`), then the connection rows die with the
 *      teardown — the stored token goes with them.
 *   2. WhatsApp: delete the Evolution instance, but only when no other
 *      workspace still uses that instance name (shared instances stay).
 *   3. Storage: bulk-delete the workspace media prefix and its product-media
 *      prefix (thumbnails live under the same prefixes).
 *   4. Database: one transaction deletes every workspace-scoped table
 *      explicitly (restrict-FK children first), marks the request completed
 *      transiently, then deletes the workspace row itself.
 *
 * Failures are retried on the next poll (idempotent steps) until the attempt
 * budget is exhausted, then the request is marked `failed` with the reason so
 * it is visible instead of silently spinning. Storage deletion happens before
 * the DB transaction on purpose: rows deleted while media survives would
 * leave orphaned objects nobody can enumerate anymore.
 */

const BATCH_LIMIT = 3;

export {
  DELETION_GRACE_MS,
  DELETION_MAX_ATTEMPTS,
  deletionDueCutoff,
  isDeletionRequestDue,
  workspaceStoragePrefixes,
} from "./workspace-deletion-policy";

async function unsubscribeMetaWebhooks(workspaceId: string): Promise<void> {
  const connections = await db
    .select({
      pageId: menaMetaConnections.pageId,
      encryptedPageAccessToken: menaMetaConnections.encryptedPageAccessToken,
    })
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId));

  for (const connection of connections) {
    try {
      const accessToken = decryptMetaToken(connection.encryptedPageAccessToken);
      const url = new URL(
        `https://graph.facebook.com/${getMetaGraphVersion()}/${encodeURIComponent(connection.pageId)}/subscribed_apps`,
      );
      url.searchParams.set("access_token", accessToken);
      const response = await fetch(url, {
        method: "DELETE",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        logger.warn(
          { workspaceId, pageId: connection.pageId, status: response.status },
          "Meta webhook unsubscribe failed during workspace deletion",
        );
      }
    } catch (error) {
      // Best effort: an expired token or unreachable graph must not block
      // erasure — the stored credentials are deleted either way, and Meta
      // auto-unsubscribes pages whose webhook keeps failing.
      logger.warn(
        { err: error, workspaceId, pageId: connection.pageId },
        "Meta webhook unsubscribe errored during workspace deletion",
      );
    }
  }
}

async function deleteEvolutionInstances(workspaceId: string): Promise<void> {
  const connections = await db
    .select({ instanceName: menaWhatsAppConnections.instanceName })
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
  const instanceNames = [
    ...new Set(connections.map((row) => row.instanceName)),
  ];

  for (const instanceName of instanceNames) {
    const [sharedElsewhere] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(menaWhatsAppConnections)
      .where(
        and(
          eq(menaWhatsAppConnections.instanceName, instanceName),
          ne(menaWhatsAppConnections.workspaceId, workspaceId),
        ),
      );
    if ((sharedElsewhere?.total ?? 0) > 0) {
      logger.info(
        { workspaceId, instanceName },
        "Evolution instance shared with another workspace; not deleting it",
      );
      continue;
    }
    try {
      await evolutionRequest(
        `instance/delete/${encodeURIComponent(instanceName)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (error instanceof EvolutionApiError && error.statusCode === 404) {
        continue; // already gone — idempotent
      }
      if (
        error instanceof EvolutionApiError &&
        error.statusCode === 503 &&
        error.message === "EVOLUTION_API_NOT_CONFIGURED"
      ) {
        logger.info(
          { workspaceId },
          "Evolution API not configured; skipping instance deletion",
        );
        return;
      }
      throw error;
    }
  }
  clearConnectionStateCache();
}

async function deleteWorkspaceRows(
  requestId: string,
  workspaceId: string,
  now: Date,
): Promise<void> {
  await db.transaction(async (transaction) => {
    // Transient 'completed' mark inside the same transaction that erases the
    // workspace: the row cannot outlive its workspace (restrict FK), so the
    // state exists for correctness of the lifecycle, not as a persisted audit
    // record — the erasure itself is the record.
    await transaction
      .update(workspaceDeletionRequests)
      .set({ status: "completed", completedAt: now })
      .where(eq(workspaceDeletionRequests.id, requestId));

    // Restrict-FK children first: content associations pin WhatsApp messages.
    for (const table of [
      menaWhatsAppContentAssociations,
      menaPostActivityEvents,
      posts,
      menaContentJobs,
      menaContentSettings,
      menaWhatsAppMessageMedia,
      productExtractionSources,
      productExtractionSuggestions,
      whatsappProductExtractionJobs,
      menaWhatsAppMessages,
      menaInventoryMovements,
      productPublicationJobs,
      productPosts,
      products,
      menaOrderDeliveryEvents,
      menaOrderEvents,
      menaOrderItems,
      menaOrders,
      menaMetaOrderIntakes,
      menaWhatsAppOrderIntakes,
      menaMetaInboxItems,
      menaMetaAutoReplyJobs,
      menaMetaAutoReplySettings,
      menaMetaWebhookSubscriptions,
      pushNotificationOutbox,
      workspaceSubscriptionUsage,
      workspaceSubscriptions,
      menaWhatsAppDirectMessages,
      menaWhatsAppAutoReplyEvents,
      menaWhatsAppSyncStates,
      menaWhatsAppGroupSelections,
      menaWhatsAppGroupJids,
      menaWhatsAppGroups,
      menaWhatsAppConnections,
      menaOAuthStates,
      menaMetaConnections,
      workspaceOnboarding,
      workspaceMembers,
      workspaceDeletionRequests,
    ] as const) {
      await transaction
        .delete(table)
        .where(eq(table.workspaceId, workspaceId));
    }

    await transaction
      .delete(workspaces)
      .where(eq(workspaces.id, workspaceId));
  });
}

async function teardownWorkspace(
  requestId: string,
  workspaceId: string,
  now: Date,
): Promise<void> {
  await unsubscribeMetaWebhooks(workspaceId);
  await deleteEvolutionInstances(workspaceId);
  await deleteMediaObjectsByPrefixes(workspaceStoragePrefixes(workspaceId));
  await deleteWorkspaceRows(requestId, workspaceId, now);
}

export async function processWorkspaceDeletionQueue(): Promise<{
  processed: number;
}> {
  const now = new Date();
  const due = await db
    .select({
      id: workspaceDeletionRequests.id,
      workspaceId: workspaceDeletionRequests.workspaceId,
      attempts: workspaceDeletionRequests.attempts,
    })
    .from(workspaceDeletionRequests)
    .where(
      and(
        eq(workspaceDeletionRequests.status, "pending"),
        lt(workspaceDeletionRequests.requestedAt, deletionDueCutoff(now)),
        lt(workspaceDeletionRequests.attempts, DELETION_MAX_ATTEMPTS),
      ),
    )
    .orderBy(asc(workspaceDeletionRequests.requestedAt))
    .limit(BATCH_LIMIT);

  let processed = 0;
  for (const request of due) {
    try {
      await teardownWorkspace(request.id, request.workspaceId, now);
      processed += 1;
      logger.info(
        { workspaceId: request.workspaceId },
        "Workspace deletion completed after grace period",
      );
    } catch (error) {
      const attempts = request.attempts + 1;
      const message =
        error instanceof Error ? error.message : "WORKSPACE_DELETION_FAILED";
      const exhausted = attempts >= DELETION_MAX_ATTEMPTS;
      await db
        .update(workspaceDeletionRequests)
        .set({
          attempts,
          lastError: message.slice(0, 500),
          ...(exhausted ? { status: "failed" as const } : {}),
        })
        .where(eq(workspaceDeletionRequests.id, request.id));
      logger.error(
        { err: error, workspaceId: request.workspaceId, attempts, exhausted },
        "Workspace deletion attempt failed",
      );
    }
  }
  return { processed };
}
