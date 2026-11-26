/**
 * whatsapp-direct-media-store.ts
 *
 * Writes the attachment rows for a direct WhatsApp message. Deliberately a
 * separate step from saving the message body: a broken media payload must
 * never lose the customer's text. Every insert is idempotent on the provider
 * message id + attachment index, so retried webhook deliveries are harmless.
 */

import { randomUUID } from "node:crypto";
import { db, menaWhatsAppDirectMessageMedia } from "@workspace/db";

import { filterWhatsAppMediaItems, type WhatsAppSyncOptions } from "./whatsapp-sync-options.ts";
import { extractMediaItemsFromMessage } from "./whatsapp-message-scope.ts";
import {
  buildWhatsAppDirectMediaRow,
  whatsappDirectMediaSourceMetadata,
} from "./whatsapp-direct-media.ts";

export type StoreWhatsAppDirectMediaInput = {
  ownerId: string;
  workspaceId: string;
  instanceName: string;
  directMessageId: string;
  providerMessageId: string;
  remoteJidHash: string;
  message: Record<string, unknown>;
  messageKey: Record<string, unknown>;
  connection: WhatsAppSyncOptions;
};

/** Returns how many attachment rows were newly created. */
export async function storeWhatsAppDirectMediaForMessage(
  input: StoreWhatsAppDirectMediaInput,
): Promise<number> {
  const extracted = extractMediaItemsFromMessage(input.message);
  const items = filterWhatsAppMediaItems(extracted, input.connection);
  if (items.length === 0) return 0;

  let created = 0;
  for (const [mediaIndex, item] of items.entries()) {
    const sourceMetadata = whatsappDirectMediaSourceMetadata({
      item,
      mediaIndex,
      messageKey: input.messageKey,
      sourceMessage: item.sourceMessage,
    });
    const row = buildWhatsAppDirectMediaRow(
      {
        ownerId: input.ownerId,
        workspaceId: input.workspaceId,
        instanceName: input.instanceName,
        directMessageId: input.directMessageId,
        providerMessageId: input.providerMessageId,
        remoteJidHash: input.remoteJidHash,
        mediaIndex,
        item,
        sourceMetadata,
      },
      randomUUID(),
    );
    const inserted = await db
      .insert(menaWhatsAppDirectMessageMedia)
      .values(row)
      .onConflictDoNothing()
      .returning({ id: menaWhatsAppDirectMessageMedia.id });
    created += inserted.length;
  }
  return created;
}
