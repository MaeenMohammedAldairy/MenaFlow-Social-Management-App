import { createHash, randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
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
} from "@workspace/db";
import {
  extractWhatsAppProductCandidates,
  isCompleteProductExtraction,
  productExtractionSourceKey,
  type ProductExtractionCandidate,
  type ProductExtractionSource,
} from "./product-extraction.ts";
import {
  getWhatsAppContentAssociationDecisions,
  getWhatsAppContentBundle,
  whatsappAssociationPairKey,
} from "./whatsapp-content-associations.ts";
import { findWhatsAppAssociationSuggestions } from "./whatsapp-association-suggestions.ts";
import type { ProductAvailability } from "./product-validation.ts";
import { normalizedProductName } from "./product-utils.ts";

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

export async function queueUnprocessedWhatsAppProductMessages(
  workspaceId: string,
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

  const messages = await db
    .select({
      id: menaWhatsAppMessages.id,
      ownerId: menaWhatsAppMessages.ownerId,
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
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp))
    .limit(200);
  if (messages.length === 0) return 0;
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
  updates: Partial<typeof whatsappProductExtractionJobs.$inferInsert>,
): Promise<void> {
  await db
    .update(whatsappProductExtractionJobs)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(
      eq(whatsappProductExtractionJobs.id, job.id),
      eq(whatsappProductExtractionJobs.workspaceId, job.workspaceId),
    ));
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
  const hasMediaPending = sourceMessages.some((item) =>
    item.mediaAvailable && item.mediaDownloadStatus !== "stored",
  );
  if (hasMediaPending) {
    const failedMedia = sourceMessages.some((item) =>
      item.mediaAvailable && item.mediaDownloadStatus === "failed",
    );
    await updateJob(job, {
      status: "waiting_media",
      stage: "media",
      lastError: failedMedia
        ? "WHATSAPP_MEDIA_DOWNLOAD_FAILED"
        : "WHATSAPP_MEDIA_DOWNLOAD_PENDING",
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
  if (!sources.some((source) => source.text)) {
    await updateJob(job, {
      status: "complete",
      stage: "extraction",
      lastError: "PRODUCT_TEXT_REQUIRED",
    });
    return;
  }
  await updateJob(job, { status: "processing", stage: "extraction", lastError: null });
  const extraction = await extractWhatsAppProductCandidates(
    job.workspaceId,
    sources,
  );

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
      const duplicate = Boolean(
        (name && seenNames.has(name)) || (sku && seenSkus.has(sku)),
      );
      const canCreate = candidate.classification === "product" &&
        Boolean(candidate.data.name?.trim()) &&
        isCompleteProductExtraction(candidate) &&
        !duplicate;
      const suggestionId = randomUUID();
      const productId = canCreate ? randomUUID() : null;
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
        status: candidate.classification === "not_product"
          ? "review"
          : duplicate
            ? "possible_duplicate"
            : productId
              ? "draft_created"
              : "review",
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
  console.info("WhatsApp product extraction completed", {
    workspaceId: job.workspaceId,
    messageId: job.messageId,
    sourceMessageCount: sourceMessageIds.length,
    completeCandidateCount: extraction.candidates.filter((candidate) =>
      candidate.classification === "product" && candidate.complete,
    ).length,
  });
}

let productQueueRunning = false;

export async function processWhatsAppProductExtractionQueue(): Promise<void> {
  if (productQueueRunning) return;
  productQueueRunning = true;
  try {
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
        const retry = job.attempts < 5;
        const delayMs = Math.min(60 * 60_000, 30_000 * (2 ** (job.attempts - 1)));
        await updateJob(job, {
          status: retry ? "pending" : "failed",
          stage: "extraction",
          lastError: reason,
          nextRunAt: new Date(Date.now() + (retry ? delayMs : 0)),
        });
        console.error("WhatsApp product extraction job failed", {
          workspaceId: job.workspaceId,
          messageId: job.messageId,
          attempt: job.attempts,
          retry,
          reason,
        });
      }
    }
  } finally {
    productQueueRunning = false;
  }
}
