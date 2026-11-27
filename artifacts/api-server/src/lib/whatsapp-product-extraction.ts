import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  lt,
  lte,
  ne,
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
  menaProductExtractionEvents,
  menaProductMatchCandidates,
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
import { queueEligibilityPolicy } from "./product-extraction-queue-eligibility.ts";
import { autoAcceptWhatsAppAssociationsForWorkspace } from "./whatsapp-association-auto-accept.ts";
import {
  decideWhatsAppExtractionMediaState,
  decideWhatsAppMediaGate,
  shouldResetMediaForRequeue,
  type ProductExtractionMediaState,
} from "./product-extraction-media-policy.ts";
import { resetFailedWhatsAppMedia } from "./whatsapp-media-reset.ts";
import {
  detectGroupDisagreement,
  extractWhatsAppProductCandidates,
  generatedProductSku,
  isCompleteProductExtraction,
  productExtractionSourceKey,
  type ProductExtractionCandidate,
  type ProductExtractionContext,
  type ProductExtractionSource,
} from "./product-extraction.ts";
import {
  extractionEventForReason,
  extractionReasonFor,
  requiresReasonForTransition,
  type ExtractionReasonCode,
} from "./product-extraction-reasons.ts";
import { whatsappProductExtractionGroupKey } from "./whatsapp-content-association-logic.ts";
import {
  PRODUCT_FACT_KINDS,
  totalFactCount,
  unverifiedFactCount,
} from "./product-facts.ts";
import { PRODUCT_EXTRACTION_PROMPT_VERSION } from "./product-extraction-prompt-version.ts";
import type { AiImage } from "./ai-image-validation.ts";
import { isCurrencyDerivedFromCountry } from "./product-currency-resolution.ts";
import { isPriceReadyForDraft } from "./product-price-parsing.ts";
import {
  computeExtractionConfidence,
  extractionConfidenceReasons,
  matchProductCandidate,
  type SenderRole,
} from "./product-intake-policy.ts";
import { recordExtractionEvent } from "./product-intake-service.ts";
import {
  getWhatsAppContentAssociationDecisions,
  getWhatsAppContentBundle,
  whatsappAssociationPairKey,
} from "./whatsapp-content-associations.ts";
import {
  findWhatsAppProductBundleSuggestions,
  selectAutoAcceptableProductBundleSuggestions,
} from "./whatsapp-association-suggestions.ts";
import type { ProductAvailability } from "./product-validation.ts";
import { normalizedProductName } from "./product-utils.ts";
import { shouldAutoCreateProductDraft } from "./product-draft-policy.ts";
import {
  prepareVisionImage,
  readStoredVisionMedia,
  selectVisionMedia,
  visionProductExtractionEnabled,
} from "./product-vision-extraction.ts";
import { readMediaObject } from "./whatsapp-media-storage.ts";
import { logger } from "./logger.ts";
import { resolveWhatsAppSourceMediaIds } from "./product-source-media.ts";

function extractionProductInput(candidate: ProductExtractionCandidate) {
  // A price without a currency cannot be a product: the catalog checks it. The
  // number is still on the suggestion, with the merchant's words for it.
  const hasVerifiedPricePair = Boolean(
    candidate.data.price && candidate.data.currency,
  );
  const priceGrounded = hasVerifiedPricePair &&
    // «confirmed» is the only state that may reach a product on its own: an
    // unquoted or ambiguous number waits for a person, which is the same rule
    // that keeps an invented price out of the catalog.
    isPriceReadyForDraft(candidate.data.priceStatus);
  return {
    sku: candidate.data.sku,
    name: candidate.data.name ?? "",
    aliases: candidate.data.aliases,
    description: candidate.data.description ?? "",
    price: priceGrounded ? candidate.data.price : null,
    currency: priceGrounded ? candidate.data.currency : null,
    rawPriceText: priceGrounded ? candidate.data.rawPriceText ?? null : null,
    priceStatus: candidate.data.priceStatus ?? null,
    features: candidate.facts.features,
    specifications: candidate.facts.specifications,
    accessories: candidate.facts.accessories,
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
  const [job] = await db
    .select()
    .from(whatsappProductExtractionJobs)
    .where(and(
      eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
      eq(whatsappProductExtractionJobs.messageId, messageId),
    ))
    .limit(1);
  if (job) {
    // A bundle accepted *after* a single-message suggestion was created has to
    // produce a new version with every source, without touching the old row.
    const [message] = await db
      .select({
        instanceName: menaWhatsAppMessages.instanceName,
        groupId: menaWhatsAppMessages.groupId,
      })
      .from(menaWhatsAppMessages)
      .where(and(
        eq(menaWhatsAppMessages.id, messageId),
        eq(menaWhatsAppMessages.workspaceId, workspaceId),
      ))
      .limit(1);
    const bundle = message?.groupId
      ? await getWhatsAppContentBundle({
          workspaceId,
          instanceName: message.instanceName,
          groupId: message.groupId,
        }, messageId)
      : null;
    if (bundle && bundle.messageIds.length > 1) {
      const [priorSource] = await db
        .select({ suggestionId: productExtractionSources.suggestionId })
        .from(productExtractionSources)
        .where(and(
          eq(productExtractionSources.workspaceId, workspaceId),
          eq(productExtractionSources.messageId, messageId),
        ))
        .limit(1);
      const [prior] = priorSource?.suggestionId
        ? await db
            .select({
              id: productExtractionSuggestions.id,
              version: productExtractionSuggestions.version,
              status: productExtractionSuggestions.status,
              productId: productExtractionSuggestions.productId,
            })
            .from(productExtractionSuggestions)
            .where(and(
              eq(productExtractionSuggestions.workspaceId, workspaceId),
              eq(productExtractionSuggestions.id, priorSource.suggestionId),
            ))
            .limit(1)
        : [];
      if (
        prior &&
        prior.status !== "superseded" &&
        prior.status !== "dismissed" &&
        !prior.productId
      ) {
        const priorSources = await db
          .select({ messageId: productExtractionSources.messageId })
          .from(productExtractionSources)
          .where(and(
            eq(productExtractionSources.workspaceId, workspaceId),
            eq(productExtractionSources.suggestionId, prior.id),
          ));
        const known = new Set(priorSources.map((item) => item.messageId));
        if (bundle.messageIds.some((id) => !known.has(id))) {
          const rulesetVersion = `v${prior.version + 1}`;
          await db
            .update(whatsappProductExtractionJobs)
            .set({
              status: "pending",
              stage: "received",
              attempts: 0,
              lastError: null,
              rulesetVersion,
              idempotencyKey: createHash("sha256")
                .update(`${workspaceId}:${messageId}:${rulesetVersion}`)
                .digest("hex"),
              nextRunAt: now,
              updatedAt: now,
            })
            .where(and(
              eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
              eq(whatsappProductExtractionJobs.id, job.id),
            ));
          return;
        }
      }
    }
  }
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
  const eligibility = queueEligibilityPolicy({
    visionExtractionEnabled: visionProductExtractionEnabled(),
  });
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
        // A photo with nothing written on it is worth queueing only when
        // something downstream can read it. With vision extraction off, such a
        // job could only finish as `PRODUCT_TEXT_REQUIRED`; with it on, refusing
        // the message would mean the stored image is never looked at by anything.
        // `media_available` also covers a `failed` download, which is the point:
        // queueing the message is what resets its media and hands the download
        // worker a fresh set of attempts.
        ...(eligibility.admitMediaOnlyMessages
          ? [eq(menaWhatsAppMessages.mediaAvailable, true)]
          : []),
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
      dedupeKey: message.id,
      idempotencyKey: extractionJobId(workspaceId, message.id),
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
      workspaceId: menaWhatsAppMessages.workspaceId,
      instanceName: menaWhatsAppMessages.instanceName,
      groupId: menaWhatsAppMessages.groupId,
      groupJid: menaWhatsAppMessages.groupJid,
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
  const suggestions = findWhatsAppProductBundleSuggestions(rows.map((item) => ({
    ...item,
    textBody: item.textBody ?? item.caption,
    messageTimestamp: item.messageTimestamp?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  })));
  const candidates = selectAutoAcceptableProductBundleSuggestions(suggestions)
    .filter((suggestion) =>
      suggestion.sourceMessageId === message.id ||
      suggestion.candidateMessageId === message.id,
    );
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
    /**
     * The event to write beside this transition. A conclusion that is not
     * reported is a conclusion nobody can count afterwards, which is why the
     * six re-extractions that died on a CHECK constraint looked identical to a
     * job that never ran.
     */
    event?: {
      event: string;
      suggestionId?: string | null;
      context?: Record<string, unknown>;
    };
  },
): Promise<void> {
  const { event, ...columns } = updates;
  const reason = columns.reasonCode;
  if (requiresReasonForTransition(columns)) {
    // Every terminal state names its reason, so an unlabelled conclusion is a
    // bug in the caller and is reported as one instead of being stored as a
    // silent `complete`.
    columns.reasonCode = extractionReasonFor({
      status: String(columns.status ?? job.status),
      reason,
    });
  }
  await db
    .update(whatsappProductExtractionJobs)
    .set({ ...columns, updatedAt: new Date() })
    .where(and(
      eq(whatsappProductExtractionJobs.id, job.id),
      eq(whatsappProductExtractionJobs.workspaceId, job.workspaceId),
    ));
  if (event) {
    await recordExtractionEvent({
      workspaceId: job.workspaceId,
      event: event.event,
      jobId: job.id,
      suggestionId: event.suggestionId ?? null,
      context: { messageId: job.messageId, ...event.context },
    });
  }
}

/** Suggestions examined per relink pass; ordered, so none is starved. */
const RELINK_SUGGESTION_BATCH = 100;

/**
 * The pace at which a job waiting on a download looks again. The media and
 * extraction queues both run every 60 seconds, so anything longer is dead time
 * added to a merchant's offer for no protection.
 */
const PRODUCT_MEDIA_WAIT_INTERVAL_MS = 60_000;

/**
 * What a product group already has stored, so a group is read once per version
 * instead of once per message.
 *
 * This replaces the guard that let a job finish as `complete` because *its own*
 * message already had a source row at `v1`. A group is one offer, so the unit of
 * coverage is the whole group: a caption that arrives after its photos were
 * stored must re-read the group together, or the price is written nowhere and the
 * merchant has to notice that themselves — which is what happened to the two
 * price-bearing messages that vanished behind a silent `complete`.
 */
/**
 * What a group has already produced.
 *
 * A group's history is looked up two ways on purpose. The `group_key` is the
 * cheap and stable one, but the identity of a group *changes* when a late
 * association is accepted: three photos read as an album become a bundle the
 * moment their caption arrives, and the rows written under the album key would
 * otherwise be invisible — re-extraction would file a second open card next to
 * the first, which is the duplicate we set out to remove. So the messages
 * themselves are the fallback: whatever covered any member of the group belongs
 * to this group's chain, including a single-message reading from before the
 * bundle existed.
 */
async function extractionGroupCoverage(input: {
  workspaceId: string;
  groupKey: string;
  messageIds: readonly string[];
  /** Inside a write, the same read has to come from the writer's transaction. */
  transaction?: Pick<typeof db, "select">;
}): Promise<{
  coveredMessageIds: string[];
  suggestions: Array<{
    id: string;
    version: number;
    itemIndex: number;
    rulesetVersion: string;
    productId: string | null;
    extractionInputHash: string | null;
    status: (typeof productExtractionSuggestions.$inferSelect)["status"];
    classification: (typeof productExtractionSuggestions.$inferSelect)["classification"];
  }>;
}> {
  const reader = input.transaction ?? db;
  const fields = {
    id: productExtractionSuggestions.id,
    version: productExtractionSuggestions.version,
    itemIndex: productExtractionSuggestions.itemIndex,
    rulesetVersion: productExtractionSuggestions.rulesetVersion,
    productId: productExtractionSuggestions.productId,
    extractionInputHash: productExtractionSuggestions.extractionInputHash,
    status: productExtractionSuggestions.status,
    classification: productExtractionSuggestions.classification,
  };
  // Flat queries rather than a join: the group's rows come from the index on
  // `(workspace, group_key)`, the links from the indexes on `message_id` and
  // `suggestion_id`.
  const [byKey, byMessages] = await Promise.all([
    reader
      .select(fields)
      .from(productExtractionSuggestions)
      .where(and(
        eq(productExtractionSuggestions.workspaceId, input.workspaceId),
        eq(productExtractionSuggestions.groupKey, input.groupKey),
      )),
    input.messageIds.length > 0
      ? reader
          .select({
            messageId: productExtractionSources.messageId,
            suggestionId: productExtractionSources.suggestionId,
          })
          .from(productExtractionSources)
          .where(and(
            eq(productExtractionSources.workspaceId, input.workspaceId),
            inArray(productExtractionSources.messageId, [...input.messageIds]),
          ))
      : Promise.resolve([]),
  ]);
  const ids = new Set(byKey.map((row) => row.id));
  const borrowedIds = [
    ...new Set(
      byMessages
        .map((row) => row.suggestionId)
        .filter((id): id is string => Boolean(id) && !ids.has(id as string)),
    ),
  ];
  const borrowed = borrowedIds.length > 0
    ? await reader
        .select(fields)
        .from(productExtractionSuggestions)
        .where(and(
          eq(productExtractionSuggestions.workspaceId, input.workspaceId),
          inArray(productExtractionSuggestions.id, borrowedIds),
        ))
    : [];
  const suggestions = [...byKey, ...borrowed];
  if (suggestions.length === 0) return { coveredMessageIds: [], suggestions: [] };
  const sourceRows = await reader
    .select({
      messageId: productExtractionSources.messageId,
      suggestionId: productExtractionSources.suggestionId,
    })
    .from(productExtractionSources)
    .where(and(
      eq(productExtractionSources.workspaceId, input.workspaceId),
      inArray(
        productExtractionSources.suggestionId,
        suggestions.map((row) => row.id),
      ),
    ));
  return {
    coveredMessageIds: [...new Set(sourceRows.map((row) => row.messageId))],
    suggestions,
  };
}

/**
 * Stores the answers a rejected extraction produced on the job row, when the
 * extractor had any to give.
 */
async function recordRejectedExtractionResponses(
  job: typeof whatsappProductExtractionJobs.$inferSelect,
  error: unknown,
): Promise<void> {
  const rejected = (error as { rejectedResponses?: unknown } | null)?.rejectedResponses;
  if (!Array.isArray(rejected) || rejected.length === 0) return;
  try {
    await db
      .update(whatsappProductExtractionJobs)
      .set({
        rawExtractionResponse: {
          rejected: rejected.filter((item): item is string => typeof item === "string"),
        },
        updatedAt: new Date(),
      })
      .where(eq(whatsappProductExtractionJobs.id, job.id));
  } catch (writeError) {
    // Diagnosing a failure must never become one: the original error still
    // travels, and this is logged as the side note it is.
    logger.warn(
      {
        workspaceId: job.workspaceId,
        jobId: job.id,
        reason:
          writeError instanceof Error
            ? writeError.message
            : "PRODUCT_EXTRACTION_RAW_RESPONSE_UNSTORED",
      },
      "Could not store the rejected extraction response",
    );
  }
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
 * The images of a group, read for the same call that reads its text.
 *
 * Reports what was available as well as what was used: a suggestion written from
 * two of thirteen photos has to be able to say so, or a reviewer cannot tell
 * «the photos had nothing to read» from «we never opened them».
 */
async function collectStoredVisionImages(
  workspaceId: string,
  sources: readonly ProductExtractionSource[],
): Promise<{
  images: AiImage[];
  /** Messages whose pictures were read, so a fact can name its photo. */
  sourceIds: string[];
  sent: number;
  stored: number;
  used: number;
  pending: number;
}> {
  const empty = {
    images: [] as AiImage[],
    sourceIds: [] as string[],
    sent: 0,
    stored: 0,
    used: 0,
    pending: 0,
  };
  // Vision stays opt-in: it spends AI quota on messages that previously cost
  // nothing. With it off the counts stay zero, which the media state reports as
  // `not_applicable` rather than as a loss.
  if (!visionProductExtractionEnabled()) return empty;
  const rows = await db
    .select({
      id: menaWhatsAppMessageMedia.id,
      messageId: menaWhatsAppMessageMedia.messageId,
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
      inArray(
        menaWhatsAppMessageMedia.messageId,
        sources.map((source) => source.id),
      ),
    ))
    .orderBy(
      asc(menaWhatsAppMessageMedia.messageId),
      asc(menaWhatsAppMessageMedia.mediaIndex),
    );
  const storedRows = rows.filter((row) => row.downloadStatus === "stored");
  const pending = rows.filter(
    (row) =>
      row.downloadStatus !== "stored" && row.downloadStatus !== "failed",
  ).length;
  if (storedRows.length === 0) {
    return { ...empty, sent: rows.length, pending };
  }
  const images: AiImage[] = [];
  const sourceIds: string[] = [];
  for (const row of selectVisionMedia(storedRows)) {
    // An image that cannot be traced to a message cannot be quoted either, so it
    // is not sent: every fact of the reading has to name a source.
    if (!row.messageId) continue;
    try {
      const buffer = await readStoredVisionMedia(row, readStoredVisionObject);
      images.push(await prepareVisionImage(buffer, row.mimeType));
      sourceIds.push(row.messageId);
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
        "Skipping image for product extraction",
      );
    }
  }
  return {
    images,
    sourceIds: [...new Set(sourceIds)],
    sent: rows.length,
    stored: storedRows.length,
    used: images.length,
    pending,
  };
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

export async function processProductExtractionJob(
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
    // A deleted or withdrawn message has nothing to read. Naming that in the
    // reason column is what lets the review screen say «هذه الرسالة لم تعد
    // متوفرة» instead of showing an offer that will never arrive.
    await updateJob(job, {
      status: "complete",
      stage: "persistence",
      reasonCode: "SKIPPED_MESSAGE_UNRECEIVABLE",
      lastError: null,
    });
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
      reasonCode: "WAITING_ASSOCIATION",
      lastError: "WHATSAPP_CONTENT_ASSOCIATION_REQUIRES_REVIEW",
      nextRunAt: new Date(Date.now() + 60 * 60_000),
      event: { event: extractionEventForReason("WAITING_ASSOCIATION") },
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
      reasonCode: "FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE",
      lastError: "WHATSAPP_ASSOCIATED_MESSAGE_UNAVAILABLE",
      event: { event: extractionEventForReason("FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE") },
    });
    return;
  }

  // One product group, one reading of it. The identity is the album or the
  // accepted bundle — never the message that happens to carry the job — so a
  // group that gains a message re-reads itself instead of filing a second card
  // for the same offer, and the version chain has something to attach to.
  const groupKey = whatsappProductExtractionGroupKey(
    {
      workspaceId: job.workspaceId,
      instanceName: message.instanceName,
      groupId: message.groupId ?? "",
    },
    {
      bundleId: confirmedBundle?.id ?? null,
      // The album's origin is part of the identity: a WhatsApp `media_group_id`
      // and a provider container id are different claims about the same digits,
      // and the worker reads them as different groups.
      mediaGroupId: message.mediaGroupId
        ? `${message.mediaGroupId}:${message.mediaGroupSource ?? "none"}`
        : null,
      messageId: message.id,
    },
  );
  const coverage = await extractionGroupCoverage({
    workspaceId: job.workspaceId,
    groupKey,
    messageIds: sourceMessages.map((item) => item.id),
  });
  const coveredMessageIds = new Set(coverage.coveredMessageIds);
  const uncoveredMessages = sourceMessages.filter(
    (item) => !coveredMessageIds.has(item.id),
  );
  const priorGroupSuggestion = coverage.suggestions.reduce(
    (best, current) => (!best || current.version > best.version ? current : best),
    null as null | (typeof coverage.suggestions)[number],
  );
  if (uncoveredMessages.length === 0 &&
      priorGroupSuggestion &&
      priorGroupSuggestion.rulesetVersion === job.rulesetVersion) {
    // Nothing new to read: every message of the group is already a source of a
    // suggestion at this version. Naming that is the point — the same test used
    // to end the job in silence, and a silent `complete` is what lost a caption
    // its price.
    await updateJob(job, {
      status: "complete",
      stage: "persistence",
      reasonCode: "SKIPPED_ALREADY_COVERED",
      lastError: null,
      event: {
        event: extractionEventForReason("SKIPPED_ALREADY_COVERED"),
        suggestionId: priorGroupSuggestion.id,
        context: { groupKey, version: priorGroupSuggestion.version },
      },
    });
    return;
  }
  // The group grew: a caption joined photos that were already read, or the
  // merchant re-ran extraction. Re-reading the whole group is what lets the
  // answer carry both halves — but only when the newcomer has something to read,
  // so a photo-less reply cannot spend a model call on every pass.
  const groupGrew = uncoveredMessages.length > 0 && coverage.suggestions.length > 0;
  if (groupGrew &&
      !uncoveredMessages.some(
        (item) =>
          messageText(item).length > 0 ||
          (item.mediaAvailable && item.mediaDownloadStatus === "stored"),
      )) {
    await updateJob(job, {
      status: "complete",
      stage: "extraction",
      reasonCode: "NEEDS_TEXT",
      lastError: "PRODUCT_TEXT_REQUIRED",
      event: {
        event: extractionEventForReason("NEEDS_TEXT"),
        context: {
          groupKey,
          unreadableMembers: uncoveredMessages.length,
        },
      },
    });
    return;
  }
  const mediaGate = decideWhatsAppMediaGate(
    sourceMessages.map((item) => ({
      id: item.id,
      hasText: messageText(item).length > 0,
      mediaAvailable: item.mediaAvailable,
      mediaDownloadStatus: item.mediaDownloadStatus,
    })),
  );
  if (mediaGate.outcome === "terminal") {
    const terminalReason: ExtractionReasonCode = "FAILED_MEDIA_UNRECOVERABLE";
    // Reached only when the bundle holds neither text nor a stored photo: the
    // download worker claims only messages whose `media_download_status` is
    // `pending`, and a retryable error keeps the row `pending` with a scheduled
    // attempt — so `failed` means the download gave up for good and nothing here
    // can ever be read. Parking the job in `waiting_media` for it would leave it
    // there forever: never resuming, never spending an attempt, never reaching a
    // state the merchant can see. Failing it is what makes it repairable —
    // re-running extraction resets the media and requeues the job.
    await updateJob(job, {
      status: "failed",
      stage: "media",
      reasonCode: terminalReason,
      lastError: mediaGate.reason,
      event: {
        event: extractionEventForReason(terminalReason),
        context: { messagesWithoutMedia: mediaGate.messageIds.length },
      },
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
    // An hour was how long this park lasted, which is longer than the media
    // worker's own cycle: a photo that landed two minutes later waited fifty-eight
    // more minutes for its offer to be read. The queue runs every 60 seconds, so
    // the wait is set to that pace. A download that gave up for good is *not*
    // waited on — the gate reports it as `failedMediaSkipped` and the bundle is
    // extracted from what exists, so this branch can only be reached while
    // something is genuinely still in flight.
    await updateJob(job, {
      status: "waiting_media",
      stage: "media",
      reasonCode: "WAITING_MEDIA",
      lastError: mediaGate.reason,
      nextRunAt: new Date(Date.now() + PRODUCT_MEDIA_WAIT_INTERVAL_MS),
    });
    await recordExtractionEvent({
      workspaceId: job.workspaceId,
      event: "EXTRACTION_WAITING_MEDIA",
      jobId: job.id,
      context: {
        messageId: job.messageId,
        // Siblings that already gave up: kept in the event so a reviewer can see
        // the offer will come back with fewer photos than the merchant sent.
        deadMediaSiblings: mediaGate.failedMessageIds.length,
      },
    });
    return;
  }
  if (mediaGate.failedMediaSkipped.length > 0) {
    // Something readable survived — the bundle's text, or a photo that did
    // arrive — so the offer is extracted and the product shows the missing
    // photo as a field to complete. Typical cause upstream: the message was
    // imported weeks after it was sent, and WhatsApp no longer serves media
    // that old, so those downloads can never succeed no matter how many
    // attempts they get.
    logger.warn(
      {
        workspaceId: job.workspaceId,
        jobId: job.id,
        skippedMessageIds: mediaGate.failedMediaSkipped,
      },
      "PRODUCT_EXTRACTION_PROCEEDING_WITHOUT_FAILED_MEDIA",
    );
  }
  const sources: ProductExtractionSource[] = sourceMessages.map((item) => ({
    id: item.id,
    // One group identity for the whole bundle, so the model reads the caption
    // with its photos instead of each message as a case of one.
    groupId: `bundle:${confirmedBundle?.id ?? message.mediaGroupId ?? message.groupId ?? message.id}`,
    groupKey,
    messageTimestamp: item.messageTimestamp?.toISOString() ?? null,
    replyToMessageId: item.replyToRemoteId
      ? sourceMessages.find((source) => source.remoteMessageId === item.replyToRemoteId)?.id ?? null
      : null,
    text: messageText(item),
  }));
  await updateJob(job, { status: "processing", stage: "extraction", lastError: null });
  const extractionContext = await workspaceExtractionContext(job.workspaceId);
  // Text and photos are one offer, so they are read by one call. Two calls were
  // the shape before: the second answer *replaced* the first, and the Massage
  // Gun message lost its name, its price («9500») and its description because
  // thirteen photos answered afterwards with only what is visible in pixels
  // («محرك قوي عالي السرعة», confidence 0.40, no price). A bundle that had text
  // was not allowed to see its images at all — a caption plus photos was read as
  // a caption.
  const visionImages = await collectStoredVisionImages(job.workspaceId, sources);
  const visionUsed = visionImages.images.length > 0;
  if (!sources.some((source) => source.text) && !visionUsed) {
    // Nothing readable: not a failure, but the merchant has to be told the
    // group carried no text and no picture anyone could open.
    await updateJob(job, {
      status: "complete",
      stage: "extraction",
      reasonCode: "NEEDS_TEXT",
      lastError: "PRODUCT_TEXT_REQUIRED",
      event: { event: extractionEventForReason("NEEDS_TEXT") },
    });
    return;
  }
  let extraction: Awaited<ReturnType<typeof extractWhatsAppProductCandidates>>;
  try {
    extraction = await extractWhatsAppProductCandidates(
      job.workspaceId,
      sources,
      {
        ...extractionContext,
        images: visionImages.images,
        // Which messages the pictures came from, so a fact read off a photo can
        // be shown with its photo next to it instead of as an unsourced claim.
        imageSourceIds: visionImages.sourceIds,
      },
    );
  } catch (error) {
    // The rejected answer is stored and the failure rethrown unchanged: the
    // retry plan, the attempt counter and the reason code all stay owned by the
    // queue, and what this adds is the thing only this job can know — what the
    // model had written.
    await recordRejectedExtractionResponses(job, error);
    throw error;
  }
  // The group's answer is kept as the model structured it: one item per product,
  // each tied to the messages it quoted. The merge that used to collapse a
  // bundle's items into one row is what put a neighbour's price on the wrong
  // product, and a bundle is one *reading*, not one product — the Drain Powder
  // album is three products and has to appear as three cards.
  const disagreement = detectGroupDisagreement(extraction.candidates);
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
  const requiresManualReview = visionUsed ||
    currencyDerivedFromCountry ||
    disagreement.mixedGroup;
  // What the group's photos did, kept on the row so a text-only extraction is
  // never mistaken for a complete one.
  const mediaState: ProductExtractionMediaState =
    visionImages.sent > 0 || visionImages.stored > 0
      ? decideWhatsAppExtractionMediaState({
          sent: visionImages.sent,
          stored: visionImages.stored,
          used: visionImages.used,
          pending: visionImages.pending,
        })
      : mediaGate.outcome === "ready" && mediaGate.failedMediaSkipped.length > 0
        ? "lost"
        : "not_applicable";
  // Vision off (or no image rows at all) while photos of the group died: the
  // offer was written without them, and the row has to say which of the two
  // happened. `not_applicable` means "this deployment does not read images";
  // `lost` means "there were images and WhatsApp would not give them back".
  const mediaIgnored = mediaState === "partial" || mediaState === "lost";
  // Which of the three ways a group can end well this was: stored as new,
  // re-read because the group grew, or stored while some of its media is gone.
  const recordedReason: ExtractionReasonCode = mediaIgnored
    ? "RECORDED_MEDIA_PARTIAL"
    : groupGrew
      ? "REEXTRACTED_GROUP_GROWN"
      : "RECORDED";

  const senderRole: SenderRole = sourceMessages.some((message) => message.fromMe)
    ? "merchant"
    : sourceMessages.some((message) => message.senderId)
      ? "customer"
      : "unknown";
  const persisted = await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`product-extraction:${job.workspaceId}`}, 0)
      )
    `);
    // The chain belongs to the group, not to the message that happened to carry
    // the job: a caption re-read with its photos is the next version of the same
    // offer, and a replay of the same run is the same version, so it writes
    // nothing twice.
    // The chain belongs to the group, not to the message that happened to carry
    // the job: a caption re-read with its photos is the next version of the same
    // offer, and a replay of the same run is the same version, so it writes
    // nothing twice. Read inside the lock, because a second member of the group
    // can be persisting at this very moment.
    const storedGroup = await extractionGroupCoverage({
      workspaceId: job.workspaceId,
      groupKey,
      messageIds: sourceMessageIds,
      transaction,
    });
    const groupState = storedGroup.suggestions;
    const storedCoverage = new Set(storedGroup.coveredMessageIds);
    const replayed = job.idempotencyKey
      ? groupState.filter(
          (row) => row.extractionInputHash === job.idempotencyKey,
        )
      : [];
    if (replayed.length > 0) {
      // The same run, twice: a retried job must not create a second version.
      return { outcome: "replayed" as const, suggestionIds: [] as string[] };
    }
    if (
      sourceMessageIds.every((id) => storedCoverage.has(id)) &&
      groupState.some((row) => row.rulesetVersion === job.rulesetVersion)
    ) {
      // Another member of the group wrote this version while we were reading.
      return { outcome: "covered" as const, suggestionIds: [] as string[] };
    }
    const priorGroupSuggestion = groupState.reduce(
      (best, current) =>
        !best || current.version > best.version ? current : best,
      null as null | (typeof groupState)[number],
    );
    const isReprocess = groupState.length > 0;
    const jobVersion =
      Number(String(job.rulesetVersion).replace(/\D/g, "")) || 1;
    const suggestionVersion = priorGroupSuggestion
      ? priorGroupSuggestion.version + (isReprocess ? 1 : 0)
      : jobVersion;
    // The row this item replaces, item by item rather than "whatever the group's
    // newest row was". Two reasons, and the second is the one that was learned the
    // hard way: a chain that names one predecessor for all three items of a
    // multi-product album makes `mena_product_extraction_version_key` (unique on
    // workspace, predecessor, version) reject the second insert — the same class
    // of silent write failure that killed the six re-extractions.
    const priorForItem = (itemIndex: number) =>
      groupState.reduce(
        (best, row) =>
          row.itemIndex === itemIndex &&
          (!best || row.version > best.version) &&
          row.version < suggestionVersion
            ? row
            : best,
        null as null | (typeof groupState)[number],
      );
    // Supersede before inserting: one group leaves one open suggestion, and the
    // older versions stay readable as the chain that produced it. A suggestion a
    // merchant already turned into a product is never superseded from behind —
    // the catalog row is theirs now, not ours.
    const supersedeIds = groupState
      .filter(
        (row) =>
          !row.productId &&
          row.status !== "superseded" &&
          // The merchant said «not a product» — a re-run does not take that
          // decision back, it leaves it where it was decided.
          row.status !== "dismissed",
      )
      .map((row) => row.id);
    if (supersedeIds.length > 0) {
      await transaction
        .update(productExtractionSuggestions)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(and(
          eq(productExtractionSuggestions.workspaceId, job.workspaceId),
          inArray(productExtractionSuggestions.id, supersedeIds),
        ));
    }

    const existingProducts = await transaction
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        aliases: products.aliases,
        normalizedName: products.normalizedName,
      })
      .from(products)
      .where(eq(products.workspaceId, job.workspaceId));
    const seenNames = new Set(
      existingProducts.map((product) =>
        product.normalizedName ?? normalizedProductName(product.name),
      ),
    );
    const seenSkus = new Set(
      existingProducts.flatMap((product) =>
        product.sku ? [product.sku.toUpperCase()] : [],
      ),
    );
    const manualReviewBySource =
      requiresManualReview || senderRole !== "merchant";
    const createdSuggestionIds: string[] = [];
    const createdProductIds: string[] = [];
    for (const [itemIndex, candidate] of extraction.candidates.entries()) {
      const sourceKey = productExtractionSourceKey(candidate.sourceMessageIds);
      const name = candidate.data.name
        ? normalizedProductName(candidate.data.name)
        : "";
      const sku = candidate.data.sku?.toUpperCase() ?? null;
      const match = matchProductCandidate({
        name: candidate.data.name,
        sku: candidate.data.sku,
        aliases: candidate.data.aliases,
        products: existingProducts,
      });
      const computedConfidence = computeExtractionConfidence({
        data: candidate.data,
        evidence: candidate.evidence,
        senderRole,
        currencyDerivedFromCountry,
        vision: visionUsed,
        generatedSku: !candidate.data.sku,
      });
      const draftCandidate = {
        classification: candidate.classification,
        data: candidate.data,
        complete: isCompleteProductExtraction(candidate),
        seenNames,
        seenSkus,
        manualReviewRequired: manualReviewBySource || match.strategy !== "new_product",
      };
      const decision = shouldAutoCreateProductDraft(draftCandidate, name, sku);
      // A suggestion that already created a product is never silently merged
      // into a new version of its group: the merchant reviews the conflict
      // instead, because the catalog row is theirs now and not ours to rewrite.
      const canCreate =
        decision.canCreate &&
        match.strategy === "new_product" &&
        !groupState.some((row) => row.productId);
      const status =
        candidate.classification !== "product"
          ? "review"
          : match.strategy === "exact_sku" ||
              match.strategy === "exact_name" ||
              match.strategy === "alias_match"
            ? "possible_duplicate"
            : canCreate
              ? "draft_created"
              : "review";
      const suggestionId = randomUUID();
      const productId = canCreate ? randomUUID() : null;
      createdSuggestionIds.push(suggestionId);
      if (productId) createdProductIds.push(productId);
      logger.info(
        {
          workspaceId: job.workspaceId,
          suggestionId,
          classification: candidate.classification,
          decision: canCreate ? decision.reason : status,
          source: requiresManualReview ? "vision" : "text",
          senderRole,
          matchStrategy: match.strategy,
          model: extraction.model,
        },
        "Product extraction suggestion recorded",
      );
      if (productId) {
        const sourceMedia = await resolveWhatsAppSourceMediaIds({
          workspaceId: job.workspaceId,
          messageIds: candidate.sourceMessageIds,
        });
        await transaction.insert(products).values({
          id: productId,
          ownerId: job.ownerId,
          workspaceId: job.workspaceId,
          ...extractionProductInput(candidate),
          sku: candidate.data.sku ?? generatedProductSku(candidate.sourceMessageIds),
          normalizedName: name || null,
          sourceTrust: senderRole,
          lastExtractionSuggestionId: suggestionId,
          updatedReason: "extraction",
          mediaUrls: sourceMedia,
          verifiedAt: null,
          updatedAt: new Date(),
        });
        if (name) seenNames.add(name);
        if (sku) seenSkus.add(sku);
        existingProducts.push({
          id: productId,
          name: candidate.data.name ?? "",
          sku: candidate.data.sku ?? null,
          aliases: candidate.data.aliases,
          normalizedName: name || null,
        });
      }
      await transaction.insert(productExtractionSuggestions).values({
        id: suggestionId,
        ownerId: job.ownerId,
        workspaceId: job.workspaceId,
        sourceKey,
        groupKey,
        version: suggestionVersion,
        itemIndex: itemIndex + 1,
        previousSuggestionId: priorForItem(itemIndex + 1)?.id ?? null,
        promptVersion: extraction.promptVersion,
        mediaState,
        senderRole,
        matchStrategy: match.strategy,
        matchedProductId: match.productId,
        matchScore: String(match.score),
        extractionInputHash: job.idempotencyKey ?? null,
        rulesetVersion: job.rulesetVersion,
        modelVersion: extraction.model,
        classification: candidate.classification,
        extractedData: {
          ...candidate.data,
          // The parts of the offer that are not a name, a price or a paragraph:
          // each with the quote that proves it, so «12 رأس تدليك» is a fact a
          // publication can use instead of a phrase buried in a description.
          features: candidate.facts.features,
          specifications: candidate.facts.specifications,
          accessories: candidate.facts.accessories,
          fact_counts: {
            features: candidate.facts.features.length,
            specifications: candidate.facts.specifications.length,
            accessories: candidate.facts.accessories.length,
            unverified: unverifiedFactCount(candidate.facts),
          },
          media_state: mediaState,
          group_key: groupKey,
          re_extracted: isReprocess,
          disagreement: disagreement.reasons,
          mixed_group: disagreement.mixedGroup,
          self_confidence: candidate.confidence,
          computed_confidence: computedConfidence,
          confidence_reasons: extractionConfidenceReasons({
            data: candidate.data,
            evidence: candidate.evidence,
            senderRole,
            currencyDerivedFromCountry,
            vision: visionUsed,
            generatedSku: !candidate.data.sku,
          }),
          generated_sku: !candidate.data.sku,
          sender_role: senderRole,
          evidence_spans: candidate.evidenceSpans ?? {},
        },
        evidence: candidate.evidence,
        confidence: { ...candidate.confidence, _overall: computedConfidence },
        aiModel: extraction.model,
        status,
        productId,
        updatedAt: new Date(),
      });
      await transaction.insert(menaProductMatchCandidates).values({
        id: randomUUID(),
        workspaceId: job.workspaceId,
        suggestionId,
        productId: match.productId ?? productId ?? "unmatched",
        strategy: match.strategy,
        score: String(match.score),
        reasons: match.reasons,
      });
      for (const messageId of candidate.sourceMessageIds) {
        await transaction.insert(productExtractionSources).values({
          workspaceId: job.workspaceId,
          messageId,
          suggestionId,
          itemIndex: itemIndex + 1,
        });
      }
    }
    return {
      outcome: "stored" as const,
      suggestionIds: createdSuggestionIds,
      productIds: createdProductIds,
      supersededIds: supersedeIds,
      version: suggestionVersion,
    };
  });

  if (persisted.outcome !== "stored") {
    // A second write of the same version lost the race to the first, or another
    // member of the group stored it while we were reading. Both are recorded as
    // what they are: nothing was lost, and the reason says so.
    await updateJob(job, {
      status: "complete",
      stage: "persistence",
      reasonCode: "SKIPPED_ALREADY_COVERED",
      lastError: null,
      promptVersion: extraction.promptVersion,
      event: {
        event: extractionEventForReason("SKIPPED_ALREADY_COVERED"),
        context: { race: persisted.outcome, groupKey },
      },
    });
    return;
  }

  await updateJob(job, {
    status: "complete",
    stage: "persistence",
    reasonCode: recordedReason,
    promptVersion: extraction.promptVersion,
    // The answer itself, kept on the job: a report that «الاستخراج ضعيف» can only
    // be acted on if the words the model sent are still somewhere.
    rawExtractionResponse: {
      model: extraction.model,
      promptVersion: extraction.promptVersion,
      candidates: extraction.candidates.length,
      response: extraction.rawResponse.slice(0, 20_000),
    },
    lastError: null,
    event: {
      event: extractionEventForReason(recordedReason),
      suggestionId: persisted.suggestionIds[0] ?? null,
      context: {
        senderRole,
        rulesetVersion: job.rulesetVersion,
        groupKey,
        version: persisted.version,
        candidateCount: extraction.candidates.length,
        productCount: persisted.productIds.length,
        supersededCount: persisted.supersededIds.length,
        mediaState,
        factCount: extraction.candidates.reduce(
          (total, candidate) => total + totalFactCount(candidate.facts),
          0,
        ),
        unverifiedFactCount: extraction.candidates.reduce(
          (total, candidate) => total + unverifiedFactCount(candidate.facts),
          0,
        ),
        model: extraction.model,
      },
    },
  });

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
        // Link first, queue second: a caption and its photos have to be one
        // group before the queue reads them, or it queues two offers that are
        // really one.
        await autoAcceptWhatsAppAssociationsForWorkspace(workspaceId);
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
 * Two conditions mark such a row:
 * - the job's own message has media that failed for good, or
 * - the job was parked with `WHATSAPP_MEDIA_DOWNLOAD_FAILED`, which is the mark
 *   the old gate wrote when *any* message of the bundle — including a sibling
 *   this join does not reach — had given up.
 *
 * The sweep releases those rows back to `pending` rather than failing them,
 * because whether a dead download is fatal is a question about the whole
 * bundle — is there text, or a photo that did arrive? — and only the gate, which
 * sees every source message, can answer it. A bundle with nothing readable left
 * is failed by the gate on the very next pass; a bundle with an offer written in
 * text is extracted instead of being thrown away for a photograph WhatsApp no
 * longer serves.
 *
 * Throttled and bounded because it runs inside a 3-second loop: a join over the
 * jobs table on every pass would cost more than the queue it protects.
 */
export async function releaseJobsWaitingOnTerminalMedia(
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
      status: "pending",
      stage: "received",
      lastError: null,
      nextRunAt: new Date(now),
      updatedAt: new Date(now),
    })
    .where(inArray(whatsappProductExtractionJobs.id, stuck.map((job) => job.id)));

  logger.warn(
    {
      jobs: stuck.length,
      workspaces: [...new Set(stuck.map((job) => job.workspaceId))].length,
      limit: waitingMediaSweepLimit,
    },
    "PRODUCT_EXTRACTION_WAITING_MEDIA_RELEASED_FOR_REDECISION",
  );
  return stuck.length;
}

let productQueueRunning = false;

export async function processWhatsAppProductExtractionQueue(): Promise<void> {
  if (productQueueRunning) return;
  productQueueRunning = true;
  try {
    await releaseJobsWaitingOnTerminalMedia();
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
        // A failure is only useful if it says which kind. A model that refused
        // to answer and a database that refused to write look identical in
        // `last_error` alone, and the six re-extractions that died on a CHECK
        // constraint were read as "the model is bad" for days.
        const failureReason: ExtractionReasonCode =
          plan.kind === "quota_pause"
            ? "PAUSED_AI_QUOTA"
            : reason.startsWith("PRODUCT_EXTRACTION_") ||
                reason.startsWith("PRODUCT_VISION_")
              ? "FAILED_MODEL_RESPONSE"
              : "FAILED_PERSISTENCE";
        await updateJob(job, {
          status: plan.status,
          stage: "extraction",
          reasonCode: failureReason,
          promptVersion: PRODUCT_EXTRACTION_PROMPT_VERSION,
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
        await recordExtractionEvent({
          workspaceId: job.workspaceId,
          event: extractionEventForReason(failureReason),
          jobId: job.id,
          context: {
            messageId: job.messageId,
            reason,
            attempt: job.attempts,
            retry: plan.kind === "retry",
          },
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

/**
 * Media downloads often finish after a suggestion has already become a draft.
 * This sweep attaches those late images/videos without touching merchant edits:
 * it only appends media ids that are not on the product yet.
 *
 * Two details are the whole point. The scan is ordered by `updated_at`, because
 * an unordered `LIMIT` returned whatever the index happened to yield and rows
 * that never came up were never relinked. And the write is one statement inside
 * the database — read the row, append, write it back — because a merchant saving
 * the product between the read and the write used to have their edit replaced by
 * the sweep's snapshot of what the media list looked like a moment earlier.
 */
export async function relinkCompletedExtractionMedia(): Promise<number> {
  const suggestions = await db
    .select({
      id: productExtractionSuggestions.id,
      workspaceId: productExtractionSuggestions.workspaceId,
      productId: productExtractionSuggestions.productId,
    })
    .from(productExtractionSuggestions)
    .where(and(
      isNotNull(productExtractionSuggestions.productId),
      ne(productExtractionSuggestions.status, "dismissed"),
    ))
    .orderBy(asc(productExtractionSuggestions.updatedAt))
    .limit(RELINK_SUGGESTION_BATCH);

  const byProduct = new Map<string, { workspaceId: string; mediaIds: Set<string> }>();
  for (const suggestion of suggestions) {
    if (!suggestion.productId) continue;
    const mediaIds = await resolveWhatsAppSourceMediaIds({
      workspaceId: suggestion.workspaceId,
      suggestionId: suggestion.id,
    });
    if (mediaIds.length === 0) continue;
    const current = byProduct.get(suggestion.productId) ?? {
      workspaceId: suggestion.workspaceId,
      mediaIds: new Set<string>(),
    };
    for (const mediaId of mediaIds) current.mediaIds.add(mediaId);
    byProduct.set(suggestion.productId, current);
  }

  let relinked = 0;
  const relinkedProducts: Array<{ productId: string; workspaceId: string; mediaCount: number }> = [];
  for (const [productId, value] of byProduct) {
    const missing = [...value.mediaIds];
    if (missing.length === 0) continue;
    // One statement, evaluated against the row as it is when the update runs:
    // appending here is what keeps a merchant's concurrent edit of the same
    // product from being overwritten.
    const updated = await db.execute(sql`
      UPDATE ${products} AS p
         SET media_urls = (
               SELECT coalesce(jsonb_agg(ordered.value ORDER BY ordered.ordinality), '[]'::jsonb)
                 FROM (
                       SELECT element.value, min(element.ordinality) AS ordinality
                         FROM jsonb_array_elements_text(
                                coalesce(nullif(p.media_urls, 'null'::jsonb), '[]'::jsonb)
                                || cast(${JSON.stringify(missing)} as jsonb)
                              ) WITH ORDINALITY AS element(value, ordinality)
                        GROUP BY element.value
                      ) AS ordered
             ),
             updated_at = now()
       WHERE p.id = ${productId}
         AND p.workspace_id = ${value.workspaceId}
         AND NOT coalesce(nullif(p.media_urls, 'null'::jsonb), '[]'::jsonb)
               @> cast(${JSON.stringify(missing)} as jsonb)
      RETURNING p.id
    `);
    const rows = (updated as unknown as { rows?: unknown[] })?.rows ?? [];
    if (rows.length === 0) continue;
    relinked += missing.length;
    relinkedProducts.push({
      productId,
      workspaceId: value.workspaceId,
      mediaCount: missing.length,
    });
  }
  for (const entry of relinkedProducts) {
    await recordExtractionEvent({
      workspaceId: entry.workspaceId,
      event: "MEDIA_RELINKED",
      context: { productId: entry.productId, mediaCount: entry.mediaCount },
    });
  }
  if (relinkedProducts.length > 0) {
    // A product that used to say «its photos are gone» no longer may: the media
    // state on its suggestions is what the review card reads. It moves to
    // `partial` and not to `included`, because relinking proves that images
    // reached the product, never that the extraction call saw them — and the
    // difference is exactly what the field exists to tell a reviewer.
    for (const entry of relinkedProducts) {
      await db
        .update(productExtractionSuggestions)
        .set({ mediaState: "partial", updatedAt: new Date() })
        .where(and(
          eq(productExtractionSuggestions.workspaceId, entry.workspaceId),
          inArray(productExtractionSuggestions.productId, [entry.productId]),
          inArray(productExtractionSuggestions.mediaState, ["lost", "pending"]),
        ));
    }
    logger.info(
      { products: relinkedProducts.length, mediaIds: relinked },
      "PRODUCT_EXTRACTION_MEDIA_RELINKED",
    );
  }
  return relinked;
}
