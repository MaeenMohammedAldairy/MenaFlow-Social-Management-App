/**
 * whatsapp-association-auto-accept.ts
 *
 * Links a merchant's caption to its photos without waiting for the app to open.
 *
 * The rule that decides which text belongs with which picture is
 * `autoAcceptWhatsAppSuggestions`, and until now the only thing that ever ran it
 * was the WhatsApp messages screen: a page load. Two consequences measured in the
 * live workspace: an album of three photos became three separate review cards
 * because nothing had linked them yet, and a text linked at 23:13 was never read
 * together with its photos, because the linking happened hours after the last
 * extraction and nothing ran again. A read path must not be the trigger for a
 * write; the queue is.
 *
 * So this runs on the auto-queue pass, over the same window of recent messages
 * the screen shows, for the groups the merchant selected. Accepting a pair
 * re-arms the group for extraction inside
 * `decideWhatsAppContentAssociation`, so a link is followed by a re-read of the
 * whole group rather than by a card that stays half-written.
 */

import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
} from "@workspace/db";
import { autoAcceptWhatsAppSuggestions } from "./whatsapp-content-associations.ts";
import type { WhatsAppSuggestionMessage } from "./whatsapp-association-suggestions.ts";
import { logger } from "./logger.ts";

/**
 * Messages per group per pass. The same recency window the review screen shows;
 * older offers are already extracted, and re-reading history on a timer would
 * spend AI quota that the merchant did not ask for.
 */
export const WHATSAPP_ASSOCIATION_AUTO_ACCEPT_WINDOW = 60;

/** Groups per workspace per pass, so one busy workspace cannot starve others. */
export const WHATSAPP_ASSOCIATION_AUTO_ACCEPT_GROUP_LIMIT = 20;

export type WhatsAppAssociationAutoAcceptResult = {
  groups: number;
  accepted: number;
  linked: string[];
};

/**
 * Runs the unambiguous product-pair rule over a workspace's selected groups.
 *
 * It does not touch the content-job queue on purpose: ingestion already enqueues
 * every message it persists (`whatsapp-sync.ts`), so an accepted pair has its
 * content job whether or not this pass runs — and importing that module here
 * would drag the marketing worker into the extraction worker's dependency
 * graph for a call that would do nothing.
 *
 * Returns the counts rather than throwing: a link that cannot be written (a pair
 * the merchant already rejected, a group that lost its selection) is not a
 * reason to stop the queue pass that follows it.
 */
export async function autoAcceptWhatsAppAssociationsForWorkspace(
  workspaceId: string,
): Promise<WhatsAppAssociationAutoAcceptResult> {
  const selections = await db
    .select({
      instanceName: menaWhatsAppGroupSelections.instanceName,
      groupId: menaWhatsAppGroupSelections.groupId,
    })
    .from(menaWhatsAppGroupSelections)
    .where(and(
      eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
      eq(menaWhatsAppGroupSelections.selected, true),
      isNotNull(menaWhatsAppGroupSelections.groupId),
    ))
    .orderBy(desc(menaWhatsAppGroupSelections.updatedAt))
    .limit(WHATSAPP_ASSOCIATION_AUTO_ACCEPT_GROUP_LIMIT);

  const result: WhatsAppAssociationAutoAcceptResult = {
    groups: 0,
    accepted: 0,
    linked: [],
  };
  for (const selection of selections) {
    const groupId = selection.groupId;
    if (!groupId) continue;
    try {
      const rows = await db
        .select()
        .from(menaWhatsAppMessages)
        .where(and(
          eq(menaWhatsAppMessages.workspaceId, workspaceId),
          eq(menaWhatsAppMessages.instanceName, selection.instanceName),
          eq(menaWhatsAppMessages.groupId, groupId),
          eq(menaWhatsAppMessages.messageStatus, "received"),
        ))
        .orderBy(desc(menaWhatsAppMessages.messageTimestamp))
        .limit(WHATSAPP_ASSOCIATION_AUTO_ACCEPT_WINDOW);
      if (rows.length < 2) continue;
      const mediaCounts = await countMediaByMessage(
        workspaceId,
        selection.instanceName,
        groupId,
        rows.map((row) => row.id),
      );
      const messages: WhatsAppSuggestionMessage[] = rows.map((message) => ({
        id: message.id,
        remoteMessageId: message.remoteMessageId,
        senderId: message.senderId,
        textBody: message.textBody,
        caption: message.caption,
        mediaAvailable: message.mediaAvailable,
        mediaGroupId: message.mediaGroupId,
        mediaGroupSource: message.mediaGroupSource,
        messageTimestamp: message.messageTimestamp?.toISOString() ?? null,
        createdAt: message.createdAt.toISOString(),
        replyToRemoteId: message.replyToRemoteId,
        mediaCount: mediaCounts.get(message.id) ?? 0,
        workspaceId: message.workspaceId,
        instanceName: message.instanceName,
        groupId: message.groupId,
        groupJid: message.groupJid,
      }));
      const accepted = await autoAcceptWhatsAppSuggestions({
        workspaceId,
        instanceName: selection.instanceName,
        groupId,
        messages,
      });
      result.groups += 1;
      if (accepted.acceptedCount === 0) continue;
      result.accepted += accepted.acceptedCount;
      result.linked.push(...accepted.messageIds);
      logger.info(
        {
          workspaceId,
          groupId,
          instanceName: selection.instanceName,
          accepted: accepted.acceptedCount,
          linked: accepted.messageIds.length,
        },
        "WHATSAPP_ASSOCIATION_AUTO_ACCEPT_PASS",
      );
    } catch (error) {
      logger.warn(
        { error, workspaceId, groupId },
        "WHATSAPP_ASSOCIATION_AUTO_ACCEPT_GROUP_FAILED",
      );
    }
  }
  return result;
}

async function countMediaByMessage(
  workspaceId: string,
  instanceName: string,
  groupId: string,
  messageIds: string[],
): Promise<Map<string, number>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({ messageId: menaWhatsAppMessageMedia.messageId })
    .from(menaWhatsAppMessageMedia)
    .where(and(
      eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
      eq(menaWhatsAppMessageMedia.instanceName, instanceName),
      eq(menaWhatsAppMessageMedia.groupId, groupId),
      inArray(menaWhatsAppMessageMedia.messageId, messageIds),
    ));
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.messageId, (counts.get(row.messageId) ?? 0) + 1);
  }
  return counts;
}
