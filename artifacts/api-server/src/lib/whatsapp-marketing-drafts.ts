import { and, eq } from "drizzle-orm";
import { db, menaWhatsAppMessages, posts } from "@workspace/db";
import { notifyPostsChanged } from "./post-events";
import { whatsappContentPostId } from "./whatsapp-albums";
import type { AiDraft } from "./whatsapp-marketing-ai";
export async function saveDraft(
  ownerId: string,
  message: typeof menaWhatsAppMessages.$inferSelect,
  sourceMessageId: string,
  draft: Partial<AiDraft>,
  reason: string,
  model: string | null,
  mediaUrls: string[],
  sourceRemoteMessageIds: string[],
  safeSourceText: string | null,
  sourceMedia: Array<{
    id: string;
    messageId: string;
    mediaType: string;
    mimeType: string | null;
    mediaIndex: number;
    messageOrder: number;
    messageTimestamp: string | null;
  }>,
  sourceGroupName: string,
  contentBundleId: string | null = null,
  readiness: {
    sourceMediaComplete: boolean;
    sourceExpectedMediaCount: number;
  } = {
    sourceMediaComplete: true,
    sourceExpectedMediaCount: mediaUrls.length,
  },
) {
  const id = whatsappContentPostId(ownerId, sourceMessageId);
  const status = "review";
  const [inserted] = await db
    .insert(posts)
    .values({
      id,
      ownerId,
      workspaceId: message.workspaceId,
      title: draft.title || (reason ? "محتوى يحتاج إلى مراجعة" : "منشور تسويقي"),
      body: draft.facebook || draft.instagram || "",
      channels: [],
      status,
      sourceType: "whatsapp",
      sourceMessageId,
      sourceGroupJid: message.groupJid,
      sourceMessageDate: message.messageTimestamp,
      sourceText: safeSourceText,
      mediaUrls,
      metadata: {
        aiGenerated: Boolean(model),
        sourceGroupName,
        instagramBody: draft.instagram ?? "",
        reviewReason: reason || draft.reason || null,
        aiModel: model,
        sourceRemoteMessageIds,
        sourceMedia,
        sourceMediaComplete: readiness.sourceMediaComplete,
        sourceExpectedMediaCount: readiness.sourceExpectedMediaCount,
        mediaGroupId: message.mediaGroupSource ? message.mediaGroupId : null,
        mediaGroupSource: message.mediaGroupSource,
        contentBundleId,
      },
      autoPublish: false,
      autoPublishChannels: [],
      publishResults: {},
      error: reason || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    notifyPostsChanged(ownerId);
    return { post: inserted, created: true };
  }
  const [existing] = await db
    .select()
    .from(posts)
    .where(and(
      eq(posts.ownerId, ownerId),
      eq(posts.workspaceId, message.workspaceId),
      eq(posts.id, id),
    ))
    .limit(1);
  if (!existing) throw new Error("POST_DEDUPLICATION_CONFLICT");
  const existingMetadata = safePublishResults(existing.metadata);
  const existingRemoteIds = Array.isArray(existingMetadata.sourceRemoteMessageIds)
    ? existingMetadata.sourceRemoteMessageIds.filter((value): value is string => typeof value === "string")
    : [];
  const mergedRemoteIds = [...new Set([...existingRemoteIds, ...sourceRemoteMessageIds])];
  const existingSourceMedia = Array.isArray(existingMetadata.sourceMedia)
    ? existingMetadata.sourceMedia.filter((item): item is {
        id: string;
        messageId: string;
        mediaType: string;
        mimeType: string | null;
        mediaIndex: number;
        messageOrder: number;
        messageTimestamp: string | null;
      } => Boolean(
        item &&
        typeof item === "object" &&
        typeof (item as Record<string, unknown>).id === "string" &&
        typeof (item as Record<string, unknown>).messageId === "string" &&
        typeof (item as Record<string, unknown>).mediaType === "string" &&
        typeof (item as Record<string, unknown>).mediaIndex === "number" &&
        typeof (item as Record<string, unknown>).messageOrder === "number" &&
        (
          (item as Record<string, unknown>).messageTimestamp === null ||
          typeof (item as Record<string, unknown>).messageTimestamp === "string"
        ),
      ))
    : [];
  const mergedSourceMedia = [...new Map(
    [...existingSourceMedia, ...sourceMedia].map((item) => [item.id, item]),
  ).values()].sort((left, right) =>
    (left.messageTimestamp ? new Date(left.messageTimestamp).getTime() : 0) -
      (right.messageTimestamp ? new Date(right.messageTimestamp).getTime() : 0) ||
    left.messageOrder - right.messageOrder ||
    left.mediaIndex - right.mediaIndex,
  );
  const mergedMetadata = {
    ...existingMetadata,
    aiGenerated: Boolean(model) || existingMetadata.aiGenerated === true,
    sourceGroupName: typeof existingMetadata.sourceGroupName === "string"
      ? existingMetadata.sourceGroupName
      : sourceGroupName,
    instagramBody: typeof existingMetadata.instagramBody === "string"
      ? existingMetadata.instagramBody
      : draft.instagram ?? "",
    reviewReason: reason || draft.reason || null,
    aiModel: model,
    sourceRemoteMessageIds: mergedRemoteIds,
    sourceMedia: mergedSourceMedia,
    sourceMediaComplete: readiness.sourceMediaComplete,
    sourceExpectedMediaCount: readiness.sourceExpectedMediaCount,
    mediaGroupId: message.mediaGroupSource ? message.mediaGroupId : null,
    mediaGroupSource: message.mediaGroupSource,
    contentBundleId:
      contentBundleId ?? existingMetadata.contentBundleId ?? null,
  };
  const removedSourceMediaIds = new Set(
    Array.isArray(existingMetadata.removedSourceMediaIds)
      ? existingMetadata.removedSourceMediaIds.filter((value): value is string => typeof value === "string")
      : [],
  );
  const mergedMediaUrls = [
    ...existing.mediaUrls,
    ...new Set(mediaUrls.filter((id) =>
      !existing.mediaUrls.includes(id) && !removedSourceMediaIds.has(id),
    )),
  ];
  const mergedSourceText = existing.sourceText ?? safeSourceText;
  if (
    mergedMediaUrls.length !== existing.mediaUrls.length ||
    mergedRemoteIds.length !== existingRemoteIds.length ||
    existing.sourceText !== mergedSourceText ||
    JSON.stringify(existingMetadata) !== JSON.stringify(mergedMetadata)
  ) {
    const [updated] = await db
      .update(posts)
      .set({
        sourceText: mergedSourceText,
        mediaUrls: mergedMediaUrls,
        metadata: mergedMetadata,
        updatedAt: new Date(),
      })
      .where(and(
        eq(posts.ownerId, ownerId),
        eq(posts.workspaceId, message.workspaceId),
        eq(posts.id, existing.id),
      ))
      .returning();
    if (updated) {
      notifyPostsChanged(ownerId);
      return { post: updated, created: false };
    }
  }
  return { post: existing, created: false };
}

export function safePublishResults(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
