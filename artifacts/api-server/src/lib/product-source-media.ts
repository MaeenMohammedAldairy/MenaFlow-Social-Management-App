import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  db,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  productExtractionSources,
} from "@workspace/db";

/**
 * One resolver for every product path that derives images from WhatsApp
 * sources. It never copies files: the stable media id already points at the
 * original object in `whatsapp-media` and is served by the signed public
 * media route and `productMediaPreviews`.
 */
export type WhatsAppSourceMediaCandidate = {
  mediaId: string;
  messageId: string;
  mediaWorkspaceId: string;
  messageWorkspaceId: string;
  groupId: string | null;
  groupJid: string | null;
  downloadStatus: string;
  messageTimestamp: Date | null;
  messageCreatedAt: Date | null;
  mediaIndex: number | null;
  mediaCreatedAt: Date | null;
};

const MAX_PRODUCT_MEDIA = 20;

function timeValue(value: Date | null | undefined): number {
  const time = value?.getTime?.() ?? Number.NaN;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

/** Pure selection so the isolation/order rules are directly testable. */
export function selectWhatsAppProductMediaIds(
  rows: readonly WhatsAppSourceMediaCandidate[],
  sourceMessageIds: readonly string[],
  workspaceId: string,
): string[] {
  const sources = new Set(sourceMessageIds);
  const sourceOrder = new Map(sourceMessageIds.map((id, index) => [id, index]));
  const unique = new Map<string, WhatsAppSourceMediaCandidate>();
  for (const row of rows) {
    if (
      !sources.has(row.messageId) ||
      row.mediaWorkspaceId !== workspaceId ||
      row.messageWorkspaceId !== workspaceId ||
      !row.groupId ||
      !row.groupJid?.endsWith("@g.us") ||
      row.downloadStatus !== "stored"
    ) continue;
    if (!unique.has(row.mediaId)) unique.set(row.mediaId, row);
  }
  return [...unique.values()]
    .sort((left, right) =>
      timeValue(left.messageTimestamp ?? left.messageCreatedAt) -
        timeValue(right.messageTimestamp ?? right.messageCreatedAt) ||
      (sourceOrder.get(left.messageId) ?? 0) - (sourceOrder.get(right.messageId) ?? 0) ||
      (left.mediaIndex ?? 0) - (right.mediaIndex ?? 0) ||
      timeValue(left.mediaCreatedAt) - timeValue(right.mediaCreatedAt) ||
      left.mediaId.localeCompare(right.mediaId),
    )
    .slice(0, MAX_PRODUCT_MEDIA)
    .map((row) => row.mediaId);
}

export async function resolveWhatsAppSourceMediaIds(input: {
  workspaceId: string;
  /** A persisted suggestion: its `product_extraction_sources` define the scope. */
  suggestionId?: string | null;
  /** A not-yet-persisted suggestion: the worker's candidate source list. */
  messageIds?: readonly string[] | null;
}): Promise<string[]> {
  let sourceMessageIds = [...new Set(input.messageIds ?? [])];
  if (input.suggestionId) {
    const sourceRows = await db
      .select({ messageId: productExtractionSources.messageId })
      .from(productExtractionSources)
      .where(and(
        eq(productExtractionSources.workspaceId, input.workspaceId),
        eq(productExtractionSources.suggestionId, input.suggestionId),
      ));
    sourceMessageIds = [...new Set(sourceRows.map((row) => row.messageId))];
  }
  if (sourceMessageIds.length === 0) return [];

  const rows = await db
    .select({
      mediaId: menaWhatsAppMessageMedia.id,
      messageId: menaWhatsAppMessageMedia.messageId,
      mediaWorkspaceId: menaWhatsAppMessageMedia.workspaceId,
      messageWorkspaceId: menaWhatsAppMessages.workspaceId,
      groupId: menaWhatsAppMessages.groupId,
      groupJid: menaWhatsAppMessages.groupJid,
      downloadStatus: menaWhatsAppMessageMedia.downloadStatus,
      messageTimestamp: menaWhatsAppMessages.messageTimestamp,
      messageCreatedAt: menaWhatsAppMessages.createdAt,
      mediaIndex: menaWhatsAppMessageMedia.mediaIndex,
      mediaCreatedAt: menaWhatsAppMessageMedia.createdAt,
    })
    .from(menaWhatsAppMessageMedia)
    .innerJoin(
      menaWhatsAppMessages,
      and(
        eq(menaWhatsAppMessages.id, menaWhatsAppMessageMedia.messageId),
        eq(menaWhatsAppMessages.workspaceId, menaWhatsAppMessageMedia.workspaceId),
        eq(menaWhatsAppMessages.instanceName, menaWhatsAppMessageMedia.instanceName),
        eq(menaWhatsAppMessages.groupId, menaWhatsAppMessageMedia.groupId),
        eq(menaWhatsAppMessages.groupJid, menaWhatsAppMessageMedia.groupJid),
      ),
    )
    .where(and(
      eq(menaWhatsAppMessageMedia.workspaceId, input.workspaceId),
      eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
      isNotNull(menaWhatsAppMessages.groupId),
      inArray(menaWhatsAppMessageMedia.messageId, sourceMessageIds),
    ))
    .orderBy(
      asc(menaWhatsAppMessages.messageTimestamp),
      asc(menaWhatsAppMessages.createdAt),
      asc(menaWhatsAppMessageMedia.mediaIndex),
      asc(menaWhatsAppMessageMedia.createdAt),
    );

  return selectWhatsAppProductMediaIds(
    rows as WhatsAppSourceMediaCandidate[],
    sourceMessageIds,
    input.workspaceId,
  );
}
