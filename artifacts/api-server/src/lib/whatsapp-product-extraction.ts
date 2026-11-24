import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  db,
  menaWhatsAppGroupSelections,
  menaWhatsAppGroups,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  productExtractionSources,
  productExtractionSuggestions,
  products,
  whatsappProductExtractionJobs,
  workspaces,
} from "@workspace/db";
import {
  QUOTA_EXHAUSTED_REASON_PREFIX,
  planExtractionFailure,
  resolveExtractionQuotaPauseMs,
} from "./extraction-quota-policy.ts";
import {
  AUTOQUEUE_WORKSPACE_BATCH_SIZE,
  isQuotaPauseRow,
  planAutoQueuePass,
  settledJobQueuePolicy,
  type ProductQueueIntent,
} from "./whatsapp-product-autoqueue-policy.ts";
import {
  decideWhatsAppMediaGate,
  shouldResetMediaForRequeue,
} from "./product-extraction-media-policy.ts";
import { resetFailedWhatsAppMedia } from "./whatsapp-media-reset.ts";
import {
  extractWhatsAppProductCandidates,
  isCompleteProductExtraction,
  productExtractionSourceKey,
  type ProductExtractionCandidate,
  type ProductExtractionContext,
  type ProductExtractionSource,
} from "./product-extraction.ts";
import { isCurrencyDerivedFromCountry } from "./product-currency-resolution.ts";
import {
  getWhatsAppContentAssociationDecisions,
  getWhatsAppContentBundle,
  whatsappAssociationPairKey,
} from "./whatsapp-content-associations.ts";
import { findWhatsAppAssociationSuggestions } from "./whatsapp-association-suggestions.ts";
import type { ProductAvailability } from "./product-validation.ts";
import { normalizedProductName } from "./product-utils.ts";
import {
  productSuggestionStatus,
  shouldAutoCreateProductDraft,
} from "./product-draft-policy.ts";
import {
  extractProductCandidatesFromImages,
  prepareVisionImage,
  readStoredVisionMedia,
  selectVisionMedia,
  visionProductExtractionEnabled,
} from "./product-vision-extraction.ts";
import { readMediaObject } from "./whatsapp-media-storage.ts";
import { logger } from "./logger.ts";

function extractionProductInput(candidate: ProductExtractionCandidate) {
  const hasVerifiedPricePair = Boolean(
    candidate.data.price && candidate.data.currency,
  );
  return {
    sku: candidate.data.sku,
    name: candidate.data.name ?? "",
    aliases: candidate.data.aliases,
    description: candidate.data.description ?? "",
    price: hasVerifiedPricePair ? candidate.data.price : null,
    currency: hasVerifiedPricePair ? candidate.data.currency : null,
    availability: (candidate.data.availability ?? "unknown") as ProductAvailability,
    status: "draft" as const,
  };
}

function extractionJobId(workspaceId: string, messageId: string): string {
  return createHash("sha256")
    .update(`whatsapp-product:${workspaceId}:${messageId}`)
    .digest("hex");
}

export async function requeueWhatsAppProductMessage(
  workspaceId: string,
  messageId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(whatsappProductExtractionJobs)
    .set({
      status: "pending",
      stage: "received",
      attempts: 0,
      lastError: null,
      nextRunAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
      eq(whatsappProductExtractionJobs.messageId, messageId),
      or(
        inArray(whatsappProductExtractionJobs.status, [
          "waiting_media",
          "waiting_association",
          "failed",
        ]),
        and(
          eq(whatsappProductExtractionJobs.status, "complete"),
          eq(whatsappProductExtractionJobs.lastError, "PRODUCT_TEXT_REQUIRED"),
        ),
      ),
    ));
}

async function hasCompleteWhatsAppProductMedia(
  workspaceId: string,
  messageId: string,
): Promise<boolean> {
  const [message] = await db
    .select({
      id: menaWhatsAppMessages.id,
      instanceName: menaWhatsAppMessages.instanceName,
      groupId: menaWhatsAppMessages.groupId,
      mediaGroupId: menaWhatsAppMessages.mediaGroupId,
      mediaGroupSource: menaWhatsAppMessages.mediaGroupSource,
    })
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.id, messageId),
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
    ))
    .limit(1);
  if (!message?.groupId) return false;

  let sourceMessageIds: string[] = [message.id];
  const confirmedBundle = await getWhatsAppContentBundle({
    workspaceId,
    instanceName: message.instanceName,
    groupId: message.groupId,
  }, message.id);
  if (confirmedBundle) {
    sourceMessageIds = confirmedBundle.messageIds;
  } else if (
    message.mediaGroupId &&
    (message.mediaGroupSource === "protocol_association" ||
      message.mediaGroupSource === "provider_album_container")
  ) {
    const albumMessages = await db
      .select({ id: menaWhatsAppMessages.id })
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.workspaceId, workspaceId),
        eq(menaWhatsAppMessages.instanceName, message.instanceName),
        eq(menaWhatsAppMessages.groupId, message.groupId),
        eq(menaWhatsAppMessages.mediaGroupId, message.mediaGroupId),
        eq(menaWhatsAppMessages.mediaGroupSource, message.mediaGroupSource),
      ));
    sourceMessageIds = albumMessages.map((item) => item.id);
  }
  sourceMessageIds = [...new Set(sourceMessageIds)];
  if (sourceMessageIds.length === 0) return false;

  const sourceMessages = await db
    .select({
      id: menaWhatsAppMessages.id,
      textBody: menaWhatsAppMessages.textBody,
      caption: menaWhatsAppMessages.caption,
      mediaAvailable: menaWhatsAppMessages.mediaAvailable,
      mediaDownloadStatus: menaWhatsAppMessages.mediaDownloadStatus,
      mediaGroupSource: menaWhatsAppMessages.mediaGroupSource,
      mediaGroupExpectedCount: menaWhatsAppMessages.mediaGroupExpectedCount,
    })
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      inArray(menaWhatsAppMessages.id, sourceMessageIds),
    ));
  if (
    sourceMessages.length !== sourceMessageIds.length ||
    !sourceMessages.some((item) => Boolean(item.textBody?.trim() || item.caption?.trim()))
  ) return false;

  const mediaRows = await db
    .select({
      messageId: menaWhatsAppMessageMedia.messageId,
      downloadStatus: menaWhatsAppMessageMedia.downloadStatus,
    })
    .from(menaWhatsAppMessageMedia)
    .where(and(
      eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
      inArray(menaWhatsAppMessageMedia.messageId, sourceMessageIds),
    ));
  if (mediaRows.length === 0) return false;

  const mediaFailed = sourceMessages.some(
    (item) => item.mediaDownloadStatus === "failed",
  ) || mediaRows.some((item) => item.downloadStatus === "failed");
  const mediaPending = sourceMessages.some((item) =>
    item.mediaAvailable &&
    item.mediaDownloadStatus !== "failed" &&
    (item.mediaDownloadStatus === "pending" ||
      !mediaRows.some((media) =>
        media.messageId === item.id && media.downloadStatus === "stored",
      )),
  );
  const expectedCount = Math.max(
    0,
    ...sourceMessages
      .filter((item) =>
        item.mediaGroupSource === "protocol_association" ||
        item.mediaGroupSource === "provider_album_container",
      )
      .map((item) => item.mediaGroupExpectedCount ?? 0),
  );
  return !mediaFailed &&
    !mediaPending &&
    expectedCount <= mediaRows.length &&
    mediaRows.every((item) => item.downloadStatus === "stored");
}

export async function queueUnprocessedWhatsAppProductMessages(
  workspaceId: string,
  messageId?: string,
  intent: ProductQueueIntent = "manual",
): Promise<number> {
  const [connection] = await db
    .select({ id: menaWhatsAppGroupSelections.id })
    .from(menaWhatsAppGroupSelections)
    .where(and(
      eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
      eq(menaWhatsAppGroupSelections.selected, true),
    ))
    .limit(1);
  if (!connection) return 0;

  const settledJobs = settledJobQueuePolicy(intent);
  const messages = await db
    .select({
      id: menaWhatsAppMessages.id,
      ownerId: menaWhatsAppMessages.ownerId,
      mediaAvailable: menaWhatsAppMessages.mediaAvailable,
      mediaDownloadStatus: menaWhatsAppMessages.mediaDownloadStatus,
    })
    .from(menaWhatsAppMessages)
    .innerJoin(
      menaWhatsAppGroups,
      and(
        eq(menaWhatsAppGroups.id, menaWhatsAppMessages.groupId),
        eq(menaWhatsAppGroups.workspaceId, workspaceId),
        eq(menaWhatsAppGroups.instanceName, menaWhatsAppMessages.instanceName),
      ),
    )
    .innerJoin(
      menaWhatsAppGroupSelections,
      and(
        eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
        eq(menaWhatsAppGroupSelections.instanceName, menaWhatsAppMessages.instanceName),
        or(
          eq(menaWhatsAppGroupSelections.groupId, menaWhatsAppMessages.groupId),
          eq(menaWhatsAppGroupSelections.groupId, menaWhatsAppGroups.parentGroupId),
        ),
        eq(menaWhatsAppGroupSelections.selected, true),
      ),
    )
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, workspaceId),
      ...(messageId ? [eq(menaWhatsAppMessages.id, messageId)] : []),
      eq(menaWhatsAppMessages.messageStatus, "received"),
      or(
        sql`length(trim(coalesce(${menaWhatsAppMessages.textBody}, ''))) > 0`,
        sql`length(trim(coalesce(${menaWhatsAppMessages.caption}, ''))) > 0`,
      ),
      notExists(
        db.select({ messageId: productExtractionSources.messageId })
          .from(productExtractionSources)
          .where(and(
            eq(productExtractionSources.workspaceId, workspaceId),
            eq(productExtractionSources.messageId, menaWhatsAppMessages.id),
          )),
      ),
      // The timer only ever looks at messages nobody has queued yet, so it
      // cannot revive a settled job or keep re-selecting the same oldest page.
      ...(settledJobs.excludeMessagesWithJobs
        ? [notExists(
            db.select({ messageId: whatsappProductExtractionJobs.messageId })
              .from(whatsappProductExtractionJobs)
              .where(and(
                eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
                eq(whatsappProductExtractionJobs.messageId, menaWhatsAppMessages.id),
              )),
          )]
        : []),
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp))
    .limit(200);
  if (messages.length === 0) return 0;

  // Give the download worker another set of attempts for messages whose media
  // failed for good. Without this, re-running extraction is a no-op for exactly
  // the messages that need it: the worker claims only `pending` media, so a
  // `failed` row is never looked at again by anything.
  const resettable = messages
    .filter((message) => shouldResetMediaForRequeue(message))
    .map((message) => message.id);
  const resetCount = resettable.length > 0
    ? await resetFailedWhatsAppMedia(workspaceId, resettable)
    : 0;

  if (messageId && !(await hasCompleteWhatsAppProductMedia(workspaceId, messageId))) {
    if (resetCount === 0) return 0;
    // The media was just put back in the download queue, so it is not complete
    // yet and will not be for a while. Falling through to create the job anyway
    // is the point: it parks in `waiting_media`, and the download worker's
    // completion path requeues it by message id — which needs a job row to
    // update. Returning 0 here instead would leave the message with a fresh
    // download and no job, so nothing would ever extract it.
  }
  const now = new Date();
  await db
    .insert(whatsappProductExtractionJobs)
    .values(messages.map((message) => ({
      id: extractionJobId(workspaceId, message.id),
      ownerId: message.ownerId,
      workspaceId,
      messageId: message.id,
      status: "pending" as const,
      stage: "received" as const,
      attempts: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    })))
    .onConflictDoNothing();
  if (settledJobs.reviveSettledJobs) {
    // Pressing «استخراج المنتجات» again means "try these once more", so a job
    // that failed — or that ended with no text to read — is put back in the
    // queue with its attempts reset. The timer never reaches this branch.
    await db
      .update(whatsappProductExtractionJobs)
      .set({
        status: "pending",
        stage: "received",
        attempts: 0,
        lastError: null,
        nextRunAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
        or(
          eq(whatsappProductExtractionJobs.status, "failed"),
          and(
            eq(whatsappProductExtractionJobs.status, "complete"),
            eq(whatsappProductExtractionJobs.lastError, "PRODUCT_TEXT_REQUIRED"),
          ),
        ),
        inArray(
          whatsappProductExtractionJobs.messageId,
          messages.map((message) => message.id),
        ),
      ));
  }
  return messages.length;
}

function messageText(message: {
  textBody: string | null;
  caption: string | null;
}): string {
  return [...new Set(
    [message.textBody, message.caption]
      .map((text) => text?.trim())
      .filter((text): text is string => Boolean(text)),
  )].join("\n").slice(0, 6000);
}

async function hasUnresolvedAssociation(message: {
  id: string;
  workspaceId: string;
  instanceName: string;
  groupId: string | null;
}): Promise<boolean> {
  if (!message.groupId) return false;
  const rows = await db
    .select({
      id: menaWhatsAppMessages.id,
      remoteMessageId: menaWhatsAppMessages.remoteMessageId,
      senderId: menaWhatsAppMessages.senderId,
      textBody: menaWhatsAppMessages.textBody,
      caption: menaWhatsAppMessages.caption,
      mediaAvailable: menaWhatsAppMessages.mediaAvailable,
      mediaGroupId: menaWhatsAppMessages.mediaGroupId,
      mediaGroupSource: menaWhatsAppMessages.mediaGroupSource,
      messageTimestamp: menaWhatsAppMessages.messageTimestamp,
      createdAt: menaWhatsAppMessages.createdAt,
      replyToRemoteId: menaWhatsAppMessages.replyToRemoteId,
      mediaCount: sql<number>`(
        SELECT count(*)::int FROM mena_whatsapp_message_media
        WHERE mena_whatsapp_message_media.workspace_id = ${message.workspaceId}
          AND mena_whatsapp_message_media.message_id = ${menaWhatsAppMessages.id}
      )`,
    })
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, message.workspaceId),
      eq(menaWhatsAppMessages.instanceName, message.instanceName),
      eq(menaWhatsAppMessages.groupId, message.groupId),
      eq(menaWhatsAppMessages.messageStatus, "received"),
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp))
    .limit(500);
  const suggestions = findWhatsAppAssociationSuggestions(rows.map((item) => ({
    ...item,
    textBody: item.textBody ?? item.caption,
    messageTimestamp: item.messageTimestamp?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  })));
  const candidates = suggestions.get(message.id) ?? [];
  if (candidates.length === 0) return false;
  const decisions = await getWhatsAppContentAssociationDecisions({
    workspaceId: message.workspaceId,
    instanceName: message.instanceName,
    groupId: message.groupId,
  });
  return candidates.some((candidate) =>
    !decisions.has(
      whatsappAssociationPairKey(message.id, candidate.candidateMessageId),
    ),
  );
}

async function updateJob(
  job: typeof whatsappProductExtractionJobs.$inferSelect,
  updates: Omit<
    Partial<typeof whatsappProductExtractionJobs.$inferInsert>,
    "attempts"
  > & {
    /** A number, or SQL when the attempt counter has to be given back. */
    attempts?: number | SQL;
  },
): Promise<void> {
  await db
    .update(whatsappProductExtractionJobs)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(
      eq(whatsappProductExtractionJobs.id, job.id),
      eq(whatsappProductExtractionJobs.workspaceId, job.workspaceId),
    ));
}

async function readStoredVisionObject(locator: {
  provider: "supabase" | "local";
  locator: string;
}): Promise<Buffer> {
  return locator.provider === "supabase"
    ? readMediaObject(locator.locator)
    : readFile(locator.locator);
}

/**
 * Reads the stored images of a bundle and extracts product candidates from
 * them. Returns null when vision extraction is off, nothing usable is stored,
 * or the model produced an unusable answer — the caller then keeps the
 * `PRODUCT_TEXT_REQUIRED` outcome it had before.
 */
async function extractCandidatesFromStoredImages(
  workspaceId: string,
  sources: readonly ProductExtractionSource[],
  context: ProductExtractionContext = {},
): Promise<{ model: string; candidates: ProductExtractionCandidate[] } | null> {
  if (!visionProductExtractionEnabled()) return null;
  const rows = await db
    .select({
      id: menaWhatsAppMessageMedia.id,
      mediaType: menaWhatsAppMessageMedia.mediaType,
      mimeType: menaWhatsAppMessageMedia.mimeType,
      sizeBytes: menaWhatsAppMessageMedia.sizeBytes,
      downloadStatus: menaWhatsAppMessageMedia.downloadStatus,
      storageProvider: menaWhatsAppMessageMedia.storageProvider,
      storageKey: menaWhatsAppMessageMedia.storageKey,
      storagePath: menaWhatsAppMessageMedia.storagePath,
      mediaIndex: menaWhatsAppMessageMedia.mediaIndex,
    })
    .from(menaWhatsAppMessageMedia)
    .where(and(
      eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
      eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
      inArray(
        menaWhatsAppMessageMedia.messageId,
        sources.map((source) => source.id),
      ),
    ))
    .orderBy(
      asc(menaWhatsAppMessageMedia.messageId),
      asc(menaWhatsAppMessageMedia.mediaIndex),
    );
  const selected = selectVisionMedia(rows);
  if (selected.length === 0) return null;

  const images = [];
  for (const row of selected) {
    try {
      const buffer = await readStoredVisionMedia(row, readStoredVisionObject);
      images.push(await prepareVisionImage(buffer, row.mimeType));
    } catch (error) {
      logger.warn(
        {
          workspaceId,
          mediaId: row.id,
          reason:
            error instanceof Error
              ? error.message
              : "PRODUCT_VISION_MEDIA_FAILED",
        },
        "Skipping image for vision product extraction",
      );
    }
  }
  if (images.length === 0) return null;
  return extractProductCandidatesFromImages(workspaceId, sources, images, context);
}

/**
 * The workspace's business country, used only to settle an ambiguous currency
 * word («45 ريال»). A missing or unknown country leaves extraction exactly as
 * strict as it was, so this lookup is allowed to fail quietly.
 */
async function workspaceExtractionContext(
  workspaceId: string,
): Promise<ProductExtractionContext> {
  try {
    const [workspace] = await db
      .select({ country: workspaces.country })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return { workspaceCountry: workspace?.country ?? null };
  } catch (error) {
    logger.warn(
      { workspaceId, error },
      "PRODUCT_EXTRACTION_WORKSPACE_COUNTRY_UNAVAILABLE",
    );
    return { workspaceCountry: null };
  }
}

async function processProductExtractionJob(
  job: typeof whatsappProductExtractionJobs.$inferSelect,
): Promise<void> {
  const [message] = await db
    .select()
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.id, job.messageId),
      eq(menaWhatsAppMessages.workspaceId, job.workspaceId),
    ))
    .limit(1);
  if (!message || message.messageStatus !== "received") {
    await updateJob(job, { status: "complete", stage: "persistence", lastError: null });
    return;
  }
  const [existingSource] = await db
    .select({ messageId: productExtractionSources.messageId })
    .from(productExtractionSources)
    .where(and(
      eq(productExtractionSources.workspaceId, job.workspaceId),
      eq(productExtractionSources.messageId, job.messageId),
    ))
    .limit(1);
  if (existingSource) {
    await updateJob(job, { status: "complete", stage: "persistence", lastError: null });
    return;
  }

  let sourceMessageIds = [message.id];
  const confirmedBundle = message.groupId
    ? await getWhatsAppContentBundle({
        workspaceId: job.workspaceId,
        instanceName: message.instanceName,
        groupId: message.groupId,
      }, message.id)
    : null;
  if (confirmedBundle) {
    sourceMessageIds = confirmedBundle.messageIds;
  } else if (await hasUnresolvedAssociation(message)) {
    await updateJob(job, {
      status: "waiting_association",
      stage: "association",
      lastError: "WHATSAPP_CONTENT_ASSOCIATION_REQUIRES_REVIEW",
      nextRunAt: new Date(Date.now() + 60 * 60_000),
    });
    return;
  } else if (
    message.mediaGroupId &&
    (message.mediaGroupSource === "protocol_association" ||
      message.mediaGroupSource === "provider_album_container")
  ) {
    const albumMessages = await db
      .select({ id: menaWhatsAppMessages.id })
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.workspaceId, job.workspaceId),
        eq(menaWhatsAppMessages.instanceName, message.instanceName),
        eq(menaWhatsAppMessages.groupId, message.groupId!),
        eq(menaWhatsAppMessages.mediaGroupId, message.mediaGroupId),
        eq(menaWhatsAppMessages.mediaGroupSource, message.mediaGroupSource),
      ));
    sourceMessageIds = albumMessages.map((item) => item.id);
  }

  const sourceMessages = await db
    .select()
    .from(menaWhatsAppMessages)
    .where(and(
      eq(menaWhatsAppMessages.workspaceId, job.workspaceId),
      inArray(menaWhatsAppMessages.id, sourceMessageIds),
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp));
  if (sourceMessages.length !== sourceMessageIds.length) {
    await updateJob(job, {
      status: "failed",
      stage: "association",
      lastError: "WHATSAPP_ASSOCIATED_MESSAGE_UNAVAILABLE",
    });
    return;
  }
  const mediaGate = decideWhatsAppMediaGate(sourceMessages);
  if (mediaGate.outcome === "terminal") {
    // `failed` media is never revisited: the download worker claims only
    // messages whose `media_download_status` is `pending`, and a retryable error
    // keeps the row `pending` with a scheduled attempt — so `failed` means the
    // download gave up for good. Parking the job in `waiting_media` for it would
    // leave it there forever: never resuming, never spending an attempt, never
    // reaching the `failed` state that shows up in `pendingJobs.failed` as
    // something a merchant can act on. Failing it is what makes it repairable —
    // re-running extraction resets the media and requeues the job.
    await updateJob(job, {
      status: "failed",
      stage: "media",
      lastError: mediaGate.reason,
    });
    logger.warn(
      {
        workspaceId: job.workspaceId,
        jobId: job.id,
        messageIds: mediaGate.messageIds,
      },
      "PRODUCT_EXTRACTION_MEDIA_TERMINALLY_FAILED",
    );
    return;
  }
  if (mediaGate.outcome === "waiting") {
    await updateJob(job, {
      status: "waiting_media",
      stage: "media",
      lastError: mediaGate.reason,
      nextRunAt: new Date(Date.now() + 60 * 60_000),
    });
    return;
  }
  const sources: ProductExtractionSource[] = sourceMessages.map((item) => ({
    id: item.id,
    groupId: `bundle:${confirmedBundle?.id ?? item.mediaGroupId ?? item.groupId ?? item.id}`,
    messageTimestamp: item.messageTimestamp?.toISOString() ?? null,
    replyToMessageId: item.replyToRemoteId
      ? sourceMessages.find((source) => source.remoteMessageId === item.replyToRemoteId)?.id ?? null
      : null,
    text: messageText(item),
  }));
  await updateJob(job, { status: "processing", stage: "extraction", lastError: null });
  const extractionContext = await workspaceExtractionContext(job.workspaceId);
  // Messages that carry only a photo used to stop here. When the deployment
  // opts into vision extraction the stored images are read and the product is
  // extracted from the text visible in them; the result always needs a human
  // review, so it never becomes an automatic draft.
  const visionExtraction = sources.some((source) => source.text)
    ? null
    : await extractCandidatesFromStoredImages(
        job.workspaceId,
        sources,
        extractionContext,
      );
  if (!sources.some((source) => source.text) && !visionExtraction) {
    await updateJob(job, {
      status: "complete",
      stage: "extraction",
      lastError: "PRODUCT_TEXT_REQUIRED",
    });
    return;
  }
  const extraction = visionExtraction ??
    (await extractWhatsAppProductCandidates(
      job.workspaceId,
      sources,
      extractionContext,
    ));
  // A currency the workspace's country settled is grounded in the message only
  // as far as the word «ريال» goes — which rial came from a setting. It stays
  // reviewable for the same reason a vision candidate does, so it never becomes
  // an automatic draft with a price the merchant has not seen.
  const currencyDerivedFromCountry = extraction.candidates.some((candidate) =>
    isCurrencyDerivedFromCountry({
      evidence: candidate.evidence.currency ?? null,
      code: candidate.data.currency,
      country: extractionContext.workspaceCountry ?? null,
    }),
  );
  const requiresManualReview = visionExtraction !== null || currencyDerivedFromCountry;

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`product-extraction:${job.workspaceId}`}, 0)
      )
    `);
    const alreadyProcessed = await transaction
      .select({ messageId: productExtractionSources.messageId })
      .from(productExtractionSources)
      .where(and(
        eq(productExtractionSources.workspaceId, job.workspaceId),
        inArray(productExtractionSources.messageId, sourceMessageIds),
      ));
    if (alreadyProcessed.length > 0) return;

    const existingProducts = await transaction
      .select({ id: products.id, name: products.name, sku: products.sku })
      .from(products)
      .where(eq(products.workspaceId, job.workspaceId));
    const seenNames = new Set(
      existingProducts.map((product) => normalizedProductName(product.name)),
    );
    const seenSkus = new Set(
      existingProducts.flatMap((product) =>
        product.sku ? [product.sku.toUpperCase()] : [],
      ),
    );
    const suggestionByMessage = new Map<string, string>();
    for (const candidate of extraction.candidates) {
      const sourceKey = productExtractionSourceKey(candidate.sourceMessageIds);
      const name = candidate.data.name
        ? normalizedProductName(candidate.data.name)
        : "";
      const sku = candidate.data.sku?.toUpperCase() ?? null;
      const draftCandidate = {
        classification: candidate.classification,
        data: candidate.data,
        complete: isCompleteProductExtraction(candidate),
        seenNames,
        seenSkus,
        manualReviewRequired: requiresManualReview,
      };
      const decision = shouldAutoCreateProductDraft(draftCandidate, name, sku);
      const suggestionId = randomUUID();
      const productId = decision.canCreate ? randomUUID() : null;
      logger.info(
        {
          workspaceId: job.workspaceId,
          suggestionId,
          classification: candidate.classification,
          decision: decision.reason,
          source: requiresManualReview ? "vision" : "text",
          model: extraction.model,
        },
        "Product extraction suggestion recorded",
      );
      if (productId) {
        const sourceMedia = await transaction
          .select({ id: menaWhatsAppMessageMedia.id })
          .from(menaWhatsAppMessageMedia)
          .where(and(
            eq(menaWhatsAppMessageMedia.workspaceId, job.workspaceId),
            inArray(menaWhatsAppMessageMedia.messageId, candidate.sourceMessageIds),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
          ))
          .orderBy(asc(menaWhatsAppMessageMedia.createdAt), asc(menaWhatsAppMessageMedia.mediaIndex))
          .limit(20);
        await transaction.insert(products).values({
          id: productId,
          ownerId: job.ownerId,
          workspaceId: job.workspaceId,
          ...extractionProductInput(candidate),
          mediaUrls: sourceMedia.map((item) => item.id),
          verifiedAt: null,
          updatedAt: new Date(),
        });
        if (name) seenNames.add(name);
        if (sku) seenSkus.add(sku);
      }
      await transaction.insert(productExtractionSuggestions).values({
        id: suggestionId,
        ownerId: job.ownerId,
        workspaceId: job.workspaceId,
        sourceKey,
        classification: candidate.classification,
        extractedData: candidate.data,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        aiModel: extraction.model,
        status: productSuggestionStatus(draftCandidate, decision),
        productId,
        updatedAt: new Date(),
      });
      for (const messageId of candidate.sourceMessageIds) {
        suggestionByMessage.set(messageId, suggestionId);
      }
    }
    await transaction.insert(productExtractionSources).values(
      sourceMessageIds.map((messageId) => ({
        workspaceId: job.workspaceId,
        messageId,
        suggestionId: suggestionByMessage.get(messageId) ?? null,
      })),
    );
  });

  await updateJob(job, { status: "complete", stage: "persistence", lastError: null });
  logger.info(
    {
      workspaceId: job.workspaceId,
      messageId: job.messageId,
      sourceMessageCount: sourceMessageIds.length,
      completeCandidateCount: extraction.candidates.filter(
        (candidate) =>
          candidate.classification === "product" && candidate.complete,
      ).length,
    },
    "WhatsApp product extraction completed",
  );
}

/**
 * Postpones every other pending job of the workspace to the same resume time.
 *
 * Each of them would fail identically within seconds, and each failure would
 * spend an attempt, so the queue waits for the quota to come back instead of
 * consuming itself. Only jobs that would run sooner are touched, so an operator
 * who deliberately requeued one message keeps that intent.
 */
async function pauseWorkspaceExtractionQueue(
  workspaceId: string,
  resumeAt: Date,
): Promise<number> {
  const paused = await db
    .update(whatsappProductExtractionJobs)
    .set({ nextRunAt: resumeAt, updatedAt: new Date() })
    .where(and(
      eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
      eq(whatsappProductExtractionJobs.status, "pending"),
      lt(whatsappProductExtractionJobs.nextRunAt, resumeAt),
    ))
    .returning({ id: whatsappProductExtractionJobs.id });
  return paused.length;
}

let autoQueueRunning = false;
let autoQueueCursor: string | null = null;

/**
 * Workspaces that have selected at least one group, strictly after a cursor,
 * ascending. Selecting a group *is* the merchant's opt-in to having that
 * conversation's messages turned into products.
 */
async function workspacesWithSelectedGroups(
  after: string | null,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ workspaceId: menaWhatsAppGroupSelections.workspaceId })
    .from(menaWhatsAppGroupSelections)
    .where(and(
      eq(menaWhatsAppGroupSelections.selected, true),
      ...(after ? [gt(menaWhatsAppGroupSelections.workspaceId, after)] : []),
    ))
    .orderBy(asc(menaWhatsAppGroupSelections.workspaceId))
    .limit(limit);
  return rows.map((row) => row.workspaceId);
}

/**
 * Whether a workspace's extraction queue is currently postponed for an
 * exhausted AI quota — see `isQuotaPauseRow` for why queueing over that would
 * burn the quota twice.
 */
export async function hasActiveExtractionQuotaPause(
  workspaceId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const [paused] = await db
    .select({
      status: whatsappProductExtractionJobs.status,
      lastError: whatsappProductExtractionJobs.lastError,
      nextRunAt: whatsappProductExtractionJobs.nextRunAt,
    })
    .from(whatsappProductExtractionJobs)
    .where(and(
      eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
      eq(whatsappProductExtractionJobs.status, "pending"),
      gt(whatsappProductExtractionJobs.nextRunAt, now),
      sql`${whatsappProductExtractionJobs.lastError} like ${`${QUOTA_EXHAUSTED_REASON_PREFIX}%`}`,
    ))
    .limit(1);
  return paused ? isQuotaPauseRow(paused, now) : false;
}

/**
 * Queues extraction work for every workspace that has selected a group, without
 * anyone pressing a button.
 *
 * Before this existed the only caller of `queueUnprocessedWhatsAppProductMessages`
 * was the manual endpoint, so a message that arrived after the merchant's last
 * tap was never extracted at all — the catalog looked idle while the queue was
 * simply never filled. Selecting a group is the opt-in, so nothing here spends
 * quota the merchant did not ask for, and the quota is still enforced downstream
 * where a job that hits the limit is postponed rather than failed.
 *
 * Returns the number of messages queued. Never throws: one unreachable
 * workspace must not stop the others, and a failed pass must not take the worker
 * loop down with it.
 */
export async function autoQueueWhatsAppProductExtractions(): Promise<number> {
  if (autoQueueRunning) return 0;
  autoQueueRunning = true;
  try {
    const page = await workspacesWithSelectedGroups(
      autoQueueCursor,
      AUTOQUEUE_WORKSPACE_BATCH_SIZE,
    );
    const restartPage =
      autoQueueCursor !== null && page.length === 0
        ? await workspacesWithSelectedGroups(null, AUTOQUEUE_WORKSPACE_BATCH_SIZE)
        : [];
    const plan = planAutoQueuePass({
      cursor: autoQueueCursor,
      workspaces: page,
      restartWorkspaces: restartPage,
    });
    autoQueueCursor = plan.nextCursor;

    let queued = 0;
    let quotaPaused = 0;
    let errored = 0;
    for (const workspaceId of plan.visit) {
      try {
        if (await hasActiveExtractionQuotaPause(workspaceId)) {
          quotaPaused += 1;
          continue;
        }
        queued += await queueUnprocessedWhatsAppProductMessages(
          workspaceId,
          undefined,
          "automatic",
        );
      } catch (error) {
        errored += 1;
        logger.warn(
          { workspaceId, error },
          "WHATSAPP_PRODUCT_AUTOQUEUE_WORKSPACE_FAILED",
        );
      }
    }

    if (plan.visit.length > 0) {
      logger.info(
        {
          workspaces: plan.visit.length,
          restarted: plan.restarted,
          queued,
          quotaPaused,
          errored,
          cursor: autoQueueCursor,
        },
        "WHATSAPP_PRODUCT_AUTOQUEUE_PASS",
      );
    }
    return queued;
  } catch (error) {
    logger.warn({ error }, "WHATSAPP_PRODUCT_AUTOQUEUE_PASS_FAILED");
    return 0;
  } finally {
    autoQueueRunning = false;
  }
}

/** Jobs examined per sweep, and how often the sweep runs. */
export const waitingMediaSweepLimit = 50;
export const waitingMediaSweepIntervalMs = 5 * 60_000;
let lastWaitingMediaSweepAt = 0;

/**
 * Fails jobs that are parked in `waiting_media` behind media that will never
 * arrive.
 *
 * The gate now refuses to park a job there in the first place, but rows written
 * before that change are already stuck and nothing else looks at them: the queue
 * selects `pending` only, so a `waiting_media` job is invisible to every pass.
 * Three such jobs sat in production for twelve hours behind a
 * `pendingJobs.waitingMedia` count that read as progress.
 *
 * Two conditions, either of which means "this can never complete":
 * - the job's own message has media that failed for good, or
 * - the job was parked with `WHATSAPP_MEDIA_DOWNLOAD_FAILED`, which is the mark
 *   the old gate wrote when *any* message of the bundle — including a sibling
 *   this join does not reach — had given up.
 *
 * Throttled and bounded because it runs inside a 3-second loop: a join over the
 * jobs table on every pass would cost more than the queue it protects.
 */
export async function failJobsWaitingOnTerminalMedia(
  now: number = Date.now(),
): Promise<number> {
  if (now - lastWaitingMediaSweepAt < waitingMediaSweepIntervalMs) return 0;
  lastWaitingMediaSweepAt = now;

  const stuck = await db
    .select({
      id: whatsappProductExtractionJobs.id,
      workspaceId: whatsappProductExtractionJobs.workspaceId,
    })
    .from(whatsappProductExtractionJobs)
    .leftJoin(
      menaWhatsAppMessages,
      and(
        eq(menaWhatsAppMessages.workspaceId, whatsappProductExtractionJobs.workspaceId),
        eq(menaWhatsAppMessages.id, whatsappProductExtractionJobs.messageId),
      ),
    )
    .where(and(
      eq(whatsappProductExtractionJobs.status, "waiting_media"),
      or(
        eq(whatsappProductExtractionJobs.lastError, "WHATSAPP_MEDIA_DOWNLOAD_FAILED"),
        and(
          eq(menaWhatsAppMessages.mediaAvailable, true),
          eq(menaWhatsAppMessages.mediaDownloadStatus, "failed"),
        ),
      ),
    ))
    .orderBy(asc(whatsappProductExtractionJobs.updatedAt))
    .limit(waitingMediaSweepLimit);
  if (stuck.length === 0) return 0;

  await db
    .update(whatsappProductExtractionJobs)
    .set({
      status: "failed",
      stage: "media",
      lastError: "WHATSAPP_MEDIA_DOWNLOAD_FAILED",
      updatedAt: new Date(now),
    })
    .where(inArray(whatsappProductExtractionJobs.id, stuck.map((job) => job.id)));

  logger.warn(
    {
      jobs: stuck.length,
      workspaces: [...new Set(stuck.map((job) => job.workspaceId))].length,
      limit: waitingMediaSweepLimit,
    },
    "PRODUCT_EXTRACTION_WAITING_MEDIA_DEAD_END_CLEARED",
  );
  return stuck.length;
}

let productQueueRunning = false;

export async function processWhatsAppProductExtractionQueue(): Promise<void> {
  if (productQueueRunning) return;
  productQueueRunning = true;
  try {
    await failJobsWaitingOnTerminalMedia();
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    await db
      .update(whatsappProductExtractionJobs)
      .set({
        status: "pending",
        stage: "received",
        updatedAt: new Date(),
      })
      .where(and(
        eq(whatsappProductExtractionJobs.status, "processing"),
        lt(whatsappProductExtractionJobs.updatedAt, staleBefore),
      ));
    const jobs = await db.transaction(async (transaction) => {
      const pending = await transaction
        .select()
        .from(whatsappProductExtractionJobs)
        .where(and(
          eq(whatsappProductExtractionJobs.status, "pending"),
          lte(whatsappProductExtractionJobs.nextRunAt, new Date()),
        ))
        .orderBy(asc(whatsappProductExtractionJobs.createdAt))
        .limit(3)
        .for("update", { skipLocked: true });
      if (pending.length === 0) return [];
      return transaction
        .update(whatsappProductExtractionJobs)
        .set({
          status: "processing",
          attempts: sql`${whatsappProductExtractionJobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(inArray(
          whatsappProductExtractionJobs.id,
          pending.map((job) => job.id),
        ))
        .returning();
    });

    for (const job of jobs) {
      try {
        await processProductExtractionJob(job);
      } catch (error) {
        const reason = error instanceof Error
          ? error.message
          : "PRODUCT_EXTRACTION_FAILED";
        const plan = planExtractionFailure({
          reason,
          attempts: job.attempts,
          quotaPauseMs: resolveExtractionQuotaPauseMs(),
        });
        await updateJob(job, {
          status: plan.status,
          stage: "extraction",
          lastError: reason,
          nextRunAt: plan.nextRunAt,
          // The attempt was already counted when the job was claimed. A quota
          // failure is not this job's fault, so the counter is given back —
          // otherwise a month without quota would fail the backlog permanently.
          ...(plan.consumeAttempt
            ? {}
            : {
                attempts: sql`greatest(${whatsappProductExtractionJobs.attempts} - 1, 0)`,
              }),
        });
        const pausedJobs = plan.pauseWorkspaceQueue
          ? await pauseWorkspaceExtractionQueue(job.workspaceId, plan.nextRunAt)
          : 0;
        if (plan.kind === "quota_pause") {
          logger.warn(
            {
              workspaceId: job.workspaceId,
              messageId: job.messageId,
              reason,
              pausedJobs,
              resumeAt: plan.nextRunAt.toISOString(),
            },
            "PRODUCT_EXTRACTION_PAUSED_FOR_AI_QUOTA",
          );
        } else {
          logger.error(
            {
              workspaceId: job.workspaceId,
              messageId: job.messageId,
              attempt: job.attempts,
              retry: plan.kind === "retry",
              reason,
            },
            "WhatsApp product extraction job failed",
          );
        }
      }
    }
  } finally {
    productQueueRunning = false;
  }
}
