/**
 * Lookup of stored direct-message attachments for the signed public-media
 * endpoint. Kept out of the group message route: that route owns the group
 * media table, while this helper owns the one-to-one media table. Both feed the
 * same byte-serving code, but neither table is a fallback for the other.
 */

import { and, eq, gt } from "drizzle-orm";

import {
  db,
  menaWhatsAppDirectMessageMedia,
  menaWhatsAppDirectMessages,
} from "@workspace/db";

export type ServableWhatsAppDirectMedia = {
  id: string;
  storagePath: string | null;
  storageProvider: string | null;
  mimeType: string | null;
  fileName: string | null;
  thumbnailPath: string | null;
  mediaType: string;
  downloadStatus: string;
};

export async function findStoredDirectAttachmentForServing(
  mediaId: string,
  workspaceId?: string,
): Promise<ServableWhatsAppDirectMedia | null> {
  const predicates = [
    eq(menaWhatsAppDirectMessageMedia.id, mediaId),
    eq(
      menaWhatsAppDirectMessages.id,
      menaWhatsAppDirectMessageMedia.directMessageId,
    ),
    eq(
      menaWhatsAppDirectMessages.workspaceId,
      menaWhatsAppDirectMessageMedia.workspaceId,
    ),
    eq(
      menaWhatsAppDirectMessages.instanceName,
      menaWhatsAppDirectMessageMedia.instanceName,
    ),
    eq(menaWhatsAppDirectMessageMedia.downloadStatus, "stored"),
    gt(menaWhatsAppDirectMessages.expiresAt, new Date()),
  ];
  if (workspaceId) {
    predicates.push(eq(menaWhatsAppDirectMessageMedia.workspaceId, workspaceId));
  }
  const [media] = await db
    .select({ media: menaWhatsAppDirectMessageMedia })
    .from(menaWhatsAppDirectMessageMedia)
    .innerJoin(
      menaWhatsAppDirectMessages,
      and(
        eq(
          menaWhatsAppDirectMessages.id,
          menaWhatsAppDirectMessageMedia.directMessageId,
        ),
        eq(
          menaWhatsAppDirectMessages.workspaceId,
          menaWhatsAppDirectMessageMedia.workspaceId,
        ),
        eq(
          menaWhatsAppDirectMessages.instanceName,
          menaWhatsAppDirectMessageMedia.instanceName,
        ),
      ),
    )
    .where(and(...predicates))
    .limit(1);
  return media?.media ?? null;
}
