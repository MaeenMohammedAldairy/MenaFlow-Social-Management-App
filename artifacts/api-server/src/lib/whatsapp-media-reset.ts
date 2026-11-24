/**
 * whatsapp-media-reset.ts
 *
 * Puts WhatsApp media whose download gave up back into the download queue.
 *
 * Its own module rather than a function inside `whatsapp-media-download.ts`
 * because that file already imports `requeueWhatsAppProductMessage` from
 * `whatsapp-product-extraction.ts`, and the caller that needs this reset is
 * `whatsapp-product-extraction.ts` itself — importing it from there would close
 * a cycle between the two.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db, menaWhatsAppMessageMedia, menaWhatsAppMessages } from "@workspace/db";
import { assertWorkspaceContext } from "./workspace-record-access";
import { logger } from "./logger.ts";

/** Rows reset per call, so one press of a button cannot rewrite a whole table. */
export const MEDIA_RESET_BATCH_LIMIT = 200;

/**
 * Puts terminally failed media back into the download queue.
 *
 * This is the only path that does. The download worker claims messages whose
 * `media_download_status` is `pending`, and a failure writes `failed` — so
 * without a reset, a message whose download gave up is never looked at again by
 * anything, and the product-extraction job that needs it fails for good with no
 * way to repair it short of editing the database. Resetting is what makes
 * "run extraction again" a real repair instead of a no-op.
 *
 * Deliberately narrow: only messages that are `media_available` and currently
 * `failed`, only their `failed` media rows, and only up to
 * `MEDIA_RESET_BATCH_LIMIT` of them. The attempt counter goes back to zero
 * because this is a human asking for a fresh set of attempts, not the worker
 * retrying on its own schedule — and a retry the worker had already scheduled is
 * left alone, since it needs no help.
 *
 * Returns the number of messages reset.
 */
export async function resetFailedWhatsAppMedia(
  workspaceId: string,
  messageIds: readonly string[],
): Promise<number> {
  assertWorkspaceContext(workspaceId);
  const ids = [...new Set(messageIds.filter((id) => typeof id === "string" && id))]
    .slice(0, MEDIA_RESET_BATCH_LIMIT);
  if (ids.length === 0) return 0;

  const failedMessages = await db
    .select({
      id: menaWhatsAppMessages.id,
      hasPayload: sql<boolean>`(${menaWhatsAppMessages.sourceMediaPayload} is not null)`,
    })
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      inArray(menaWhatsAppMessages.id, ids),
      eq(menaWhatsAppMessages.mediaAvailable, true),
      eq(menaWhatsAppMessages.mediaDownloadStatus, "failed"),
    ));
  if (failedMessages.length === 0) return 0;

  // A message whose media payload was dropped has nothing left to download from,
  // so resetting it would put it back in a queue that can only fail it again.
  const resettable = failedMessages.filter((message) => message.hasPayload);
  const unusable = failedMessages.length - resettable.length;
  if (resettable.length === 0) {
    if (unusable > 0) {
      logger.warn(
        { workspaceId, messages: unusable },
        "WHATSAPP_MEDIA_RESET_SKIPPED_NO_PAYLOAD",
      );
    }
    return 0;
  }

  const resetIds = resettable.map((message) => message.id);
  const now = new Date();
  await db
    .update(menaWhatsAppMessageMedia)
    .set({
      downloadStatus: "pending",
      downloadAttempts: 0,
      failureReason: null,
      lastError: null,
      nextAttemptAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
      inArray(menaWhatsAppMessageMedia.messageId, resetIds),
      eq(menaWhatsAppMessageMedia.downloadStatus, "failed"),
    ));
  await db
    .update(menaWhatsAppMessages)
    .set({
      mediaDownloadStatus: "pending",
      mediaDownloadError: null,
      updatedAt: now,
    })
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      inArray(menaWhatsAppMessages.id, resetIds),
    ));

  logger.info(
    { workspaceId, messages: resetIds.length, unusable },
    "WHATSAPP_MEDIA_RESET_FOR_REDOWNLOAD",
  );
  return resetIds.length;
}
