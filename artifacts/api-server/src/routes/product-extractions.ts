import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, gte, inArray, ne, notInArray, sql } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaWhatsAppGroups,
  menaWhatsAppMessageMedia,
  menaInventoryMovements,
  menaProductChanges,
  menaProductChangeProposals,
  menaProductExtractionEvents,
  menaProductMatchCandidates,
  menaWhatsAppMessages,
  productExtractionSources,
  productExtractionSuggestions,
  products,
  whatsappProductExtractionJobs,
} from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";
import { resolveWhatsAppSourceMediaIds } from "../lib/product-source-media.ts";

import { requestOwnerId, requireOwnerId } from "../lib/owner-access";

import { queueUnprocessedWhatsAppProductMessages } from "../lib/whatsapp-product-extraction";
import {
  QUOTA_EXHAUSTED_REASON_PREFIX,
  estimateExtractionQuota,
} from "../lib/extraction-quota-policy";
import { getSubscriptionOverview } from "../lib/subscriptions";
import { normalizedProductName } from "../lib/product-utils.ts";
import {
  acceptedExtractionProductFields,
  missingProductFieldMessages,
  missingProductFields,
} from "../lib/product-draft-policy";
import { parseProductInput } from "../lib/product-validation";
import {
  buildProductExtractionPagination,
  parseProductExtractionListQuery,
  summarizeProductExtractionSuggestions,
  productExtractionHiddenStatuses,
} from "../lib/product-extraction-list-policy";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { buildChangeDiff } from "../lib/product-intake-policy.ts";
import {
  recordExtractionEvent,
  recordProductChanges,
  requireProductWriter,
} from "../lib/product-intake-service.ts";
import { reopenWhatsAppProductExtractionGroup } from "../lib/whatsapp-product-group-reopen.ts";
import { extractionReasonMessage } from "../lib/product-extraction-reasons.ts";
import { productExtractionMediaStateMessage } from "../lib/product-extraction-media-policy.ts";
import type { ProductFact } from "../lib/product-facts.ts";

const router = Router();

/**
 * What the batch just queued will cost in AI quota.
 *
 * Queueing two hundred messages on a plan that includes ten generations used to
 * look free until the queue quietly paused. The estimate is information, so a
 * subscription read that fails must never block the extraction itself.
 */
async function extractionQuotaEstimate(workspaceId: string, messages: number) {
  try {
    const overview = await getSubscriptionOverview(workspaceId);
    const plan = overview.plans.find(
      (candidate) => candidate.id === overview.planId,
    );
    return estimateExtractionQuota({
      messages,
      used: overview.usage.aiGenerations,
      limit: plan?.limits.aiGenerations ?? 0,
    });
  } catch (error) {
    logger.warn(
      {
        workspaceId,
        reason:
          error instanceof Error ? error.message : "QUOTA_ESTIMATE_FAILED",
      },
      "Could not estimate the AI quota cost of product extraction",
    );
    return null;
  }
}
import {
  mediaUrls,
  mediaRequestOrigin,
  type ProductMediaPreview,
  productMediaUrl,
  catalogProductResponse,
} from "./product-route-helpers";
import { logger } from "../lib/logger.ts";

router.get(
  "/social/products/whatsapp-extractions",
  requireWorkspace,
  async (req, res) => {
    if (!requireOwnerId(req, res)) return;
    const workspaceId = requestWorkspaceId(req);
    // A flat page of the fifty newest suggestions cannot serve a review queue:
    // most of them are `not_product` — a message that turned out to be a post
    // candidate or a greeting — so the few suggestions holding an actual product
    // were buried under cards that say «لم يستخرج منتجًا من الرسالة», and
    // anything past the fiftieth row was unreachable. Filters and an offset make
    // the queue pagable, and the counts below keep the badge honest about what is
    // actually waiting for a decision.
    const listQuery = parseProductExtractionListQuery(
      req.query as Record<string, unknown>,
    );
    if (!listQuery.ok) {
      res.status(400).json({ error: listQuery.error });
      return;
    }
    const notDismissed = and(
      eq(productExtractionSuggestions.workspaceId, workspaceId),
      ne(productExtractionSuggestions.status, "dismissed"),
    );
    const countRows = await db
      .select({
        classification: productExtractionSuggestions.classification,
        status: productExtractionSuggestions.status,
        total: sql<number>`count(*)::int`,
      })
      .from(productExtractionSuggestions)
      .where(notDismissed)
      .groupBy(
        productExtractionSuggestions.classification,
        productExtractionSuggestions.status,
      );
    const suggestionCounts = summarizeProductExtractionSuggestions(countRows);
    const senderRoleFilter =
      typeof req.query.senderRole === "string" &&
      ["merchant", "customer", "unknown"].includes(req.query.senderRole)
        ? (req.query.senderRole as "merchant" | "customer" | "unknown")
        : null;
    // Superseded versions stay out of the queue unless the client asked for them
    // by name: the chain is readable through `?status=superseded`, but a review
    // surface that shows an answered card next to its replacement is the
    // duplication the merchant is being asked to look past.
    const hiddenStatuses = productExtractionHiddenStatuses(listQuery.statuses);
    const filteredWhere = and(
      notDismissed,
      ...(hiddenStatuses.length > 0
        ? [notInArray(productExtractionSuggestions.status, hiddenStatuses)]
        : []),
      ...(listQuery.classification
        ? [eq(productExtractionSuggestions.classification, listQuery.classification)]
        : []),
      ...(listQuery.statuses.length > 0
        ? [inArray(productExtractionSuggestions.status, listQuery.statuses)]
        : []),
      ...(senderRoleFilter
        ? [eq(productExtractionSuggestions.senderRole, senderRoleFilter)]
        : []),
    );
    const suggestions = await db
      .select()
      .from(productExtractionSuggestions)
      .where(filteredWhere)
      .orderBy(desc(productExtractionSuggestions.createdAt))
      .limit(listQuery.limit)
      .offset(listQuery.offset);
    const unfiltered =
      listQuery.classification === null &&
      listQuery.statuses.length === 0 &&
      senderRoleFilter === null;
    const total = unfiltered
      ? suggestionCounts.total
      : (
          await db
            .select({ total: sql<number>`count(*)::int` })
            .from(productExtractionSuggestions)
            .where(filteredWhere)
        )[0]?.total ?? 0;
    const pagination = buildProductExtractionPagination({
      total,
      limit: listQuery.limit,
      offset: listQuery.offset,
    });
    const possibleDuplicateSuggestions = suggestions.filter(
      (suggestion) => suggestion.status === "possible_duplicate",
    );
    const workspaceProducts = possibleDuplicateSuggestions.length
      ? await db
          .select({
            id: products.id,
            name: products.name,
            sku: products.sku,
            status: products.status,
            description: products.description,
            price: products.price,
            currency: products.currency,
            availability: products.availability,
          })
          .from(products)
          .where(eq(products.workspaceId, workspaceId))
      : [];
    const duplicateProductsBySuggestionId = new Map(
      possibleDuplicateSuggestions.map((suggestion) => {
        const extracted = suggestion.extractedData as {
          name?: string | null;
          sku?: string | null;
        };
        const normalizedName = extracted.name
          ? normalizedProductName(extracted.name)
          : "";
        const normalizedSku = extracted.sku?.trim().toUpperCase();
        const matches = workspaceProducts
          .filter(
            (product) =>
              (normalizedName &&
                normalizedProductName(product.name) === normalizedName) ||
              (normalizedSku &&
                product.sku?.trim().toUpperCase() === normalizedSku),
          )
          .slice(0, 3);
        return [
          suggestion.id,
          matches.map(
            ({
              id,
              name,
              sku,
              status,
              description,
              price,
              currency,
              availability,
            }) => ({
              id,
              name,
              sku,
              status,
              description,
              price,
              currency,
              availability,
            }),
          ),
        ];
      }),
    );
    const suggestionIds = suggestions.map(({ id }) => id);
    const sourceRows = suggestionIds.length
      ? await db
          .select({
            suggestionId: productExtractionSources.suggestionId,
            messageId: menaWhatsAppMessages.id,
            textBody: menaWhatsAppMessages.textBody,
            caption: menaWhatsAppMessages.caption,
            senderName: menaWhatsAppMessages.senderName,
            messageTimestamp: menaWhatsAppMessages.messageTimestamp,
            groupName: menaWhatsAppGroups.name,
          })
          .from(productExtractionSources)
          .innerJoin(
            menaWhatsAppMessages,
            and(
              eq(menaWhatsAppMessages.id, productExtractionSources.messageId),
              eq(menaWhatsAppMessages.workspaceId, workspaceId),
            ),
          )
          .leftJoin(
            menaWhatsAppGroups,
            and(
              eq(menaWhatsAppGroups.id, menaWhatsAppMessages.groupId),
              eq(menaWhatsAppGroups.workspaceId, workspaceId),
            ),
          )
          .where(
            and(
              eq(productExtractionSources.workspaceId, workspaceId),
              inArray(productExtractionSources.suggestionId, suggestionIds),
            ),
          )
          .orderBy(asc(menaWhatsAppMessages.messageTimestamp))
      : [];
    const sourceMediaRows = sourceRows.length
      ? await db
          .select({
            messageId: menaWhatsAppMessageMedia.messageId,
            id: menaWhatsAppMessageMedia.id,
            mediaType: menaWhatsAppMessageMedia.mediaType,
          })
          .from(menaWhatsAppMessageMedia)
          .where(
            and(
              eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
              eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
              inArray(menaWhatsAppMessageMedia.messageId, [
                ...new Set(sourceRows.map(({ messageId }) => messageId)),
              ]),
            ),
          )
          .orderBy(
            asc(menaWhatsAppMessageMedia.createdAt),
            asc(menaWhatsAppMessageMedia.mediaIndex),
          )
      : [];
    // Jobs that are waiting on something the merchant must do (approve an
    // association, wait for a download) or that failed, so the catalog can say
    // why nothing new appeared instead of looking idle.
    const jobStatusRows = await db
      .select({
        status: whatsappProductExtractionJobs.status,
        total: sql<number>`count(*)::int`,
      })
      .from(whatsappProductExtractionJobs)
      .where(eq(whatsappProductExtractionJobs.workspaceId, workspaceId))
      .groupBy(whatsappProductExtractionJobs.status);
    const jobCounts = Object.fromEntries(
      jobStatusRows.map((row) => [row.status, row.total]),
    ) as Record<string, number>;
    // Pending jobs held back by an exhausted AI quota. They look like an idle
    // queue from the outside, so the catalog says why nothing is progressing
    // and that it resumes on its own.
    const [quotaPausedRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
        eq(whatsappProductExtractionJobs.status, "pending"),
        sql`${whatsappProductExtractionJobs.lastError} like ${`${QUOTA_EXHAUSTED_REASON_PREFIX}%`}`,
      ));
    // Messages that were read and held nothing readable: a photo with no
    // caption, a sticker, a voice note. Their jobs are `complete`, so they are
    // not a failure and not waiting on anything — which is exactly why they were
    // invisible until now. Six such messages sat on the live workspace with no
    // suggestion row, no error and nothing on screen to say where they went.
    const [noTextRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
        eq(whatsappProductExtractionJobs.status, "complete"),
        eq(whatsappProductExtractionJobs.lastError, "PRODUCT_TEXT_REQUIRED"),
      ));
    // Jobs that ended `complete` because the group had already been read at this
    // ruleset version. Not a failure and not a wait — but the answer to «I
    // pressed reprocess and nothing happened», which used to require reading the
    // queue by hand.
    const [alreadyCoveredRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
        eq(whatsappProductExtractionJobs.status, "complete"),
        eq(whatsappProductExtractionJobs.reasonCode, "SKIPPED_ALREADY_COVERED"),
      ));
    const pendingJobs = {
      pending: jobCounts.pending ?? 0,
      processing: jobCounts.processing ?? 0,
      waitingMedia: jobCounts.waiting_media ?? 0,
      waitingAssociation: jobCounts.waiting_association ?? 0,
      failed: jobCounts.failed ?? 0,
      quotaPaused: quotaPausedRow?.total ?? 0,
      noText: noTextRow?.total ?? 0,
      alreadyCovered: alreadyCoveredRow?.total ?? 0,
    };
    const requestOrigin = mediaRequestOrigin(req);
    const sourceMediaByMessageId = new Map<string, ProductMediaPreview[]>();
    for (const media of sourceMediaRows) {
      const url = productMediaUrl(media.id, media.mediaType, requestOrigin);
      if (!url) continue;
      const current = sourceMediaByMessageId.get(media.messageId) ?? [];
      current.push({ id: media.id, url, mediaType: media.mediaType });
      sourceMediaByMessageId.set(media.messageId, current);
    }
    const sourcesBySuggestionId = new Map<
      string,
      Array<{
        id: string;
        text: string;
        senderName: string | null;
        messageTimestamp: string | null;
        groupName: string | null;
        mediaPreviews: ProductMediaPreview[];
      }>
    >();
    for (const source of sourceRows) {
      if (!source.suggestionId) continue;
      const current = sourcesBySuggestionId.get(source.suggestionId) ?? [];
      current.push({
        id: source.messageId,
        text: [source.textBody, source.caption]
          .filter((value): value is string => Boolean(value?.trim()))
          .filter((value, index, values) => values.indexOf(value) === index)
          .join("\n"),
        senderName: source.senderName,
        messageTimestamp: source.messageTimestamp?.toISOString() ?? null,
        groupName: source.groupName,
        mediaPreviews: sourceMediaByMessageId.get(source.messageId) ?? [],
      });
      sourcesBySuggestionId.set(source.suggestionId, current);
    }
    res.json({
      suggestions: suggestions.map((suggestion) => {
        const suggestionSources = sourcesBySuggestionId.get(suggestion.id) ?? [];
        const extracted = (suggestion.extractedData ?? {}) as {
          name?: string | null;
          description?: string | null;
          price?: string | null;
          currency?: string | null;
          availability?: string | null;
        };
        const missingFields = missingProductFields({
          name: extracted.name ?? null,
          description: extracted.description ?? null,
          price: extracted.price ?? null,
          currency: extracted.currency ?? null,
          availability: extracted.availability ?? null,
          mediaUrls: suggestionSources.flatMap(
            (source) => source.mediaPreviews.map((preview) => preview.id),
          ),
        });
        return {
          ...suggestion,
          sources: suggestionSources,
          missingFields,
          missingFieldMessages: missingProductFieldMessages(missingFields),
          // What the group's photos did, in words: `partial` and `lost` are
          // different problems with different fixes, and the card has to show it.
          mediaStateMessage: suggestion.mediaState
            ? productExtractionMediaStateMessage(suggestion.mediaState)
            : null,
          ...(suggestion.status === "possible_duplicate"
            ? {
                possibleDuplicateProducts:
                  duplicateProductsBySuggestionId.get(suggestion.id) ?? [],
              }
            : {}),
        };
      }),
      pendingJobs,
      suggestionCounts,
      pagination,
    });
  },
);

router.post(
  "/social/products/extract-whatsapp",
  requireWorkspace,
  async (req, res) => {
    if (!requireOwnerId(req, res)) return;
    const workspaceId = requestWorkspaceId(req);
    const hasTargetMessage = req.body?.messageId !== undefined;
    const messageId =
      typeof req.body?.messageId === "string"
        ? req.body.messageId.trim()
        : "";
    if (hasTargetMessage && !messageId) {
      res.status(400).json({ error: "معرّف الرسالة غير صالح." });
      return;
    }
    try {
      const queuedMessages =
        await queueUnprocessedWhatsAppProductMessages(
          workspaceId,
          messageId || undefined,
        );
      const quota = await extractionQuotaEstimate(workspaceId, queuedMessages);
      res.status(202).json({
        queuedMessages,
        ...(quota ? { quota } : {}),
      });
    } catch (error) {
      logger.error(
        {
          workspaceId,
          reason:
            error instanceof Error ? error.message : "PRODUCT_QUEUE_FAILED",
        },
        "Failed to queue WhatsApp product extraction",
      );
      res.status(500).json({
        error: "تعذر جدولة معالجة الرسائل. أعد المحاولة بعد قليل.",
      });
    }
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/create-draft",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    const ownerId = requireOwnerId(req, res);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) return;
    const suggestionId = metaString(req.params.id);
    if (!suggestionId) {
      res.status(400).json({ error: "معرّف الاقتراح غير صالح." });
      return;
    }
    const result = await db.transaction(async (transaction) => {
      const [suggestion] = await transaction
        .select()
        .from(productExtractionSuggestions)
        .where(
          and(
            eq(productExtractionSuggestions.id, suggestionId),
            eq(productExtractionSuggestions.workspaceId, workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!suggestion) return { status: "missing" as const };
      if (suggestion.status === "draft_created" && suggestion.productId) {
        const [product] = await transaction
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, suggestion.productId),
              eq(products.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        return product
          ? { status: "created" as const, product }
          : { status: "missing" as const };
      }
      const manualProduct = req.body?.product;
      const hasManualProduct = manualProduct !== undefined;
      const overrideReason =
        typeof req.body?.overrideReason === "string"
          ? req.body.overrideReason.trim()
          : "";
      if (
        suggestion.status === "possible_duplicate" &&
        hasManualProduct &&
        !overrideReason
      ) {
        return { status: "override_reason_required" as const };
      }
      if (
        suggestion.status !== "review" &&
        !(suggestion.status === "possible_duplicate" && hasManualProduct)
      ) {
        return { status: "conflict" as const };
      }
      if (suggestion.classification === "not_product" && !hasManualProduct) {
        return { status: "incomplete" as const };
      }
      const candidate = suggestion.extractedData as Partial<{
        name: string | null;
        sku: string | null;
        aliases: string[];
        description: string | null;
        price: string | null;
        currency: string | null;
        availability: "in_stock" | "out_of_stock" | "preorder" | null;
        priceStatus: "confirmed" | "unquoted" | "ambiguous" | "missing";
        rawPriceText: string | null;
        features: ProductFact[];
        specifications: ProductFact[];
        accessories: ProductFact[];
      }>;
      // The number and the unit a card carries go to the product as they are:
      // `priceStatus` and `rawPriceText` below say how sure they are, and
      // publication refuses a missing currency on its own.
      const acceptedPrice = acceptedExtractionProductFields({
        price: candidate.price,
        currency: candidate.currency,
        rawPriceText: candidate.rawPriceText,
        priceStatus: candidate.priceStatus,
      });
      const input = parseProductInput(
        hasManualProduct
          ? {
              ...manualProduct,
              status: "draft",
            }
          : {
              sku: candidate.sku,
              name: candidate.name,
              aliases: candidate.aliases ?? [],
              description: candidate.description ?? "",
              price: acceptedPrice.price,
              currency: acceptedPrice.currency,
              availability: candidate.availability ?? "unknown",
              status: "draft",
              mediaUrls: [],
            },
      );
      if (!input) return { status: "incomplete" as const };
      const { inventoryReason, ...productInput } = input;
      const sourceMedia = await resolveWhatsAppSourceMediaIds({
        workspaceId,
        suggestionId,
      });
      const [product] = await transaction
        .insert(products)
        .values({
          id: randomUUID(),
          ownerId,
          workspaceId,
          ...productInput,
          normalizedName: normalizedProductName(productInput.name),
          sourceTrust:
            suggestion.senderRole === "merchant" ? "merchant" : "customer",
          lastExtractionSuggestionId: suggestionId,
          updatedReason: overrideReason ? "duplicate_override" : "extraction",
          availability:
            input.inventoryTracked && (input.stockOnHand ?? 0) <= 0
              ? "out_of_stock"
              : input.inventoryTracked
                ? "in_stock"
                : input.availability,
          mediaUrls: sourceMedia,
          // The reading's structured parts come along with the name and the
          // price: a merchant accepting a card should land the same product the
          // automatic path would have written, not a thinner one. Facts keep
          // their quotes, so the editor can show where each line came from.
          features: candidate.features ?? [],
          specifications: candidate.specifications ?? [],
          accessories: candidate.accessories ?? [],
          priceStatus: acceptedPrice.priceStatus,
          rawPriceText: acceptedPrice.rawPriceText,
          verifiedAt: null,
          updatedAt: new Date(),
        })
        .returning();
      if (!product) throw new Error("PRODUCT_EXTRACTION_DRAFT_CREATE_FAILED");
      if (product.stockOnHand > 0) {
        await transaction.insert(menaInventoryMovements).values({
          id: randomUUID(),
          workspaceId,
          productId: product.id,
          actorId: ownerId,
          type: "opening_balance",
          stockDelta: product.stockOnHand,
          reason: inventoryReason || "رصيد افتتاحي",
          createdAt: new Date(),
        });
      }
      await transaction
        .update(productExtractionSuggestions)
        .set({
          status: "draft_created",
          productId: product.id,
          overrideReason: overrideReason || null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(productExtractionSuggestions.id, suggestionId),
            eq(productExtractionSuggestions.workspaceId, workspaceId),
          ),
        );
      return { status: "created" as const, product };
    });
    if (result.status === "missing") {
      res.status(404).json({ error: "لم يتم العثور على اقتراح المنتج." });
      return;
    }
    if (result.status === "conflict") {
      res.status(409).json({
        error: "راجع المنتج المرتبط بالاقتراح أو عالج المطابقة المحتملة أولاً.",
      });
      return;
    }
    if (result.status === "incomplete") {
      res.status(422).json({
        error: "لا يمكن إنشاء مسودة قبل استخراج اسم منتج صالح على الأقل.",
      });
      return;
    }
    if (result.status === "override_reason_required") {
      res.status(409).json({
        error: "هذا الاقتراح مطابق لمنتج موجود. اكتب سبباً واضحاً لإنشاء منتج مختلف قبل المتابعة.",
      });
      return;
    }
    res.status(201).json({
      product: await catalogProductResponse(
        result.product,
        workspaceId,
        [],
        mediaRequestOrigin(req),
      ),
      postIds: [],
    });
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/dismiss",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    if (!requireOwnerId(req, res)) return;
    const workspaceId = requestWorkspaceId(req);
    const suggestionId = metaString(req.params.id);
    if (!suggestionId) {
      res.status(400).json({ error: "معرّف الاقتراح غير صالح." });
      return;
    }
    const [updated] = await db
      .update(productExtractionSuggestions)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(
        and(
          eq(productExtractionSuggestions.id, suggestionId),
          eq(productExtractionSuggestions.workspaceId, workspaceId),
          ne(productExtractionSuggestions.status, "draft_created"),
        ),
      )
      .returning({ id: productExtractionSuggestions.id });
    if (!updated) {
      res
        .status(404)
        .json({ error: "لم يتم العثور على اقتراح قابل للاستبعاد." });
      return;
    }
    res.json({ dismissed: true });
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/restore",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const suggestionId = metaString(req.params.id);
    if (!suggestionId) {
      res.status(400).json({ error: "معرّف الاقتراح غير صالح." });
      return;
    }
    const [restored] = await db
      .update(productExtractionSuggestions)
      .set({ status: "review", updatedAt: new Date() })
      .where(and(
        eq(productExtractionSuggestions.id, suggestionId),
        eq(productExtractionSuggestions.workspaceId, workspaceId),
        eq(productExtractionSuggestions.status, "dismissed"),
      ))
      .returning({ id: productExtractionSuggestions.id });
    if (!restored) {
      res.status(404).json({ error: "الاقتراح غير موجود أو ليس مستبعداً." });
      return;
    }
    await recordExtractionEvent({
      workspaceId,
      event: "SUGGESTION_RESTORED",
      suggestionId,
    });
    res.json({ restored: true });
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/review",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    const ownerId = requireOwnerId(req, res);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) return;
    const suggestionId = metaString(req.params.id);
    const field = req.body?.field;
    const correct = req.body?.correct;
    const reviewableFields = new Set([
      "classification",
      "grouping",
      "name",
      "description",
      "sku",
      "price",
      "currency",
      "availability",
    ]);
    if (
      !suggestionId ||
      typeof field !== "string" ||
      !reviewableFields.has(field) ||
      typeof correct !== "boolean"
    ) {
      res.status(400).json({ error: "تقييم الاقتراح غير صالح." });
      return;
    }
    const [updated] = await db
      .update(productExtractionSuggestions)
      .set({
        fieldReview: sql`coalesce(${productExtractionSuggestions.fieldReview}, '{}'::jsonb) || jsonb_build_object(${field}, ${correct})`,
        reviewedBy: ownerId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productExtractionSuggestions.id, suggestionId),
          eq(productExtractionSuggestions.workspaceId, workspaceId),
          ne(productExtractionSuggestions.status, "dismissed"),
        ),
      )
      .returning({ id: productExtractionSuggestions.id });
    if (!updated) {
      res.status(404).json({ error: "لم يتم العثور على اقتراح قابل للتقييم." });
      return;
    }
    res.json({ reviewed: true, field, correct });
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/reprocess",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const suggestionId = metaString(req.params.id);
    if (!suggestionId) {
      res.status(400).json({ error: "معرّف الاقتراح غير صالح." });
      return;
    }
    const [suggestion] = await db
      .select()
      .from(productExtractionSuggestions)
      .where(and(
        eq(productExtractionSuggestions.id, suggestionId),
        eq(productExtractionSuggestions.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!suggestion) {
      res.status(404).json({ error: "لم يتم العثور على الاقتراح." });
      return;
    }
    // The whole group is re-read, not the one message that happened to carry the
    // suggestion: a caption re-extracted without its photos produces the same
    // half-answer the merchant is asking us to fix.
    const sourceRows = suggestion.groupKey
      ? await db
          .select({ messageId: productExtractionSources.messageId })
          .from(productExtractionSources)
          .innerJoin(
            productExtractionSuggestions,
            and(
              eq(
                productExtractionSuggestions.id,
                productExtractionSources.suggestionId,
              ),
              eq(
                productExtractionSuggestions.workspaceId,
                productExtractionSources.workspaceId,
              ),
            ),
          )
          .where(and(
            eq(productExtractionSources.workspaceId, workspaceId),
            eq(productExtractionSuggestions.groupKey, suggestion.groupKey),
          ))
      : await db
          .select({ messageId: productExtractionSources.messageId })
          .from(productExtractionSources)
          .where(and(
            eq(productExtractionSources.workspaceId, workspaceId),
            eq(productExtractionSources.suggestionId, suggestionId),
          ));
    const messageIds = [...new Set(sourceRows.map((row) => row.messageId))];
    if (messageIds.length === 0) {
      res.status(422).json({ error: "لا توجد رسالة مصدر يمكن إعادة تحليلها." });
      return;
    }
    const active = await db
      .select({
        messageId: whatsappProductExtractionJobs.messageId,
        status: whatsappProductExtractionJobs.status,
      })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
        inArray(whatsappProductExtractionJobs.messageId, messageIds),
        inArray(whatsappProductExtractionJobs.status, ["pending", "processing"]),
      ))
      .limit(1);
    if (active.length > 0) {
      // Telling the merchant the group is already being read, instead of
      // accepting a second request that a unique index would quietly drop: the
      // insert used to be `onConflictDoNothing`, so a reprocess of a message
      // with a live job answered 202 «queued» and never ran.
      res.status(409).json({
        error: "هذه المجموعة قيد التحليل بالفعل.",
        status: active[0].status,
        messageId: active[0].messageId,
      });
      return;
    }
    const reopened = await reopenWhatsAppProductExtractionGroup({
      workspaceId,
      messageIds,
      reason: "bundle_grown",
    });
    await recordExtractionEvent({
      workspaceId,
      event: "EXTRACTION_REPROCESSED",
      suggestionId,
      context: {
        rulesetVersion: reopened.rulesetVersion,
        groupKey: suggestion.groupKey,
        messages: messageIds.length,
      },
    });
    res.status(202).json({
      rulesetVersion: reopened.rulesetVersion,
      queued: reopened.reopened + reopened.created > 0,
      reopened: reopened.reopened,
      created: reopened.created,
      // Whether the queue is even running: a job that nobody polls is not a
      // request that will be served, and the screen has to be able to say so.
      workerEnabled: process.env.WHATSAPP_PRODUCT_EXTRACTION_WORKER_ENABLED !== "false",
    });
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/propose-update",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const ownerId = requestOwnerId(req);
    const suggestionId = metaString(req.params.id);
    if (!suggestionId || !ownerId) {
      res.status(400).json({ error: "معرّف الاقتراح غير صالح." });
      return;
    }
    const [suggestion] = await db
      .select()
      .from(productExtractionSuggestions)
      .where(and(
        eq(productExtractionSuggestions.id, suggestionId),
        eq(productExtractionSuggestions.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!suggestion) {
      res.status(404).json({ error: "لم يتم العثور على الاقتراح." });
      return;
    }
    const productId =
      typeof req.body?.productId === "string"
        ? req.body.productId
        : suggestion.matchedProductId;
    if (!productId) {
      res.status(422).json({ error: "لا يوجد منتج مطابق لتحديثه." });
      return;
    }
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "المنتج المطابق غير موجود في المساحة." });
      return;
    }
    const candidate = suggestion.extractedData as Record<string, unknown>;
    const diff = buildChangeDiff(
      ["name", "description", "price", "currency", "availability", "aliases"],
      {
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency,
        availability: product.availability,
        aliases: product.aliases,
      },
      {
        name: typeof candidate.name === "string" ? candidate.name : product.name,
        description:
          typeof candidate.description === "string"
            ? candidate.description
            : product.description,
        price: typeof candidate.price === "string" ? candidate.price : product.price,
        currency:
          typeof candidate.currency === "string" ? candidate.currency : product.currency,
        availability:
          typeof candidate.availability === "string"
            ? candidate.availability
            : product.availability,
        aliases: Array.isArray(candidate.aliases) ? candidate.aliases : product.aliases,
      },
      suggestion.evidence as Record<string, string | null>,
    );
    if (!Object.keys(diff).length) {
      res.status(422).json({ error: "لا توجد تغييرات جديدة في هذا الاقتراح." });
      return;
    }
    const proposalId = randomUUID();
    await db.insert(menaProductChangeProposals).values({
      id: proposalId,
      workspaceId,
      productId,
      suggestionId,
      diff,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();
    await db
      .update(productExtractionSuggestions)
      .set({ status: "update_proposed", updatedAt: new Date() })
      .where(and(
        eq(productExtractionSuggestions.id, suggestionId),
        eq(productExtractionSuggestions.workspaceId, workspaceId),
      ));
    await recordExtractionEvent({
      workspaceId,
      event: "PROPOSAL_CREATED",
      suggestionId,
      context: { productId, fields: Object.keys(diff) },
    });
    res.status(201).json({ proposalId, diff });
  },
);

router.post(
  "/social/products/change-proposals/:id/decide",
  requireWorkspace,
  requireProductWriter,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const actorId = requestOwnerId(req);
    const proposalId = metaString(req.params.id);
    const decision = req.body?.decision;
    if (!proposalId || (decision !== "accepted" && decision !== "rejected")) {
      res.status(400).json({ error: "قرار التحديث غير صالح." });
      return;
    }
    const [proposal] = await db
      .select()
      .from(menaProductChangeProposals)
      .where(and(
        eq(menaProductChangeProposals.id, proposalId),
        eq(menaProductChangeProposals.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!proposal || proposal.status !== "proposed") {
      res.status(404).json({ error: "مقترح التحديث غير موجود أو تم البت فيه." });
      return;
    }
    const [product] = await db
      .select()
      .from(products)
      .where(and(
        eq(products.id, proposal.productId),
        eq(products.workspaceId, workspaceId),
      ))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "المنتج المرتبط بالمقترح غير موجود." });
      return;
    }
    const diff = proposal.diff as Record<string, { before: unknown; after: unknown }>;
    if (decision === "accepted") {
      const patch: Record<string, unknown> = {};
      for (const [field, change] of Object.entries(diff)) {
        if (field in product) patch[field] = change.after;
      }
      const nextName =
        typeof patch.name === "string" ? patch.name : product.name;
      patch.normalizedName = normalizedProductName(nextName);
      patch.updatedBy = actorId;
      patch.updatedReason = "extraction_update";
      patch.updatedAt = new Date();
      await db
        .update(products)
        .set(patch)
        .where(and(
          eq(products.id, product.id),
          eq(products.workspaceId, workspaceId),
        ));
      await recordProductChanges(
        Object.entries(diff)
          .filter(([field]) => field in product)
          .map(([field, change]) => ({
            workspaceId,
            productId: product.id,
            field,
            before: change.before,
            after: change.after,
            sourceType: "extraction" as const,
            sourceId: proposal.suggestionId,
            actorId,
          })),
      );
    }
    await db
      .update(menaProductChangeProposals)
      .set({
        status: decision,
        decidedBy: actorId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(menaProductChangeProposals.id, proposalId),
        eq(menaProductChangeProposals.workspaceId, workspaceId),
      ));
    await db
      .update(productExtractionSuggestions)
      .set({
        status: decision === "accepted" ? "accepted_update" : "rejected_update",
        updatedAt: new Date(),
      })
      .where(and(
        eq(productExtractionSuggestions.id, proposal.suggestionId),
        eq(productExtractionSuggestions.workspaceId, workspaceId),
      ));
    await recordExtractionEvent({
      workspaceId,
      event: decision === "accepted" ? "PROPOSAL_ACCEPTED" : "PROPOSAL_REJECTED",
      suggestionId: proposal.suggestionId,
      context: { proposalId, productId: proposal.productId },
    });
    res.json({ status: decision, changedFields: Object.keys(diff) });
  },
);

router.get(
  "/social/products/:id/changes",
  requireWorkspace,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const productId = metaString(req.params.id);
    if (!productId) {
      res.status(400).json({ error: "معرّف المنتج غير صالح." });
      return;
    }
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.workspaceId, workspaceId)))
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "المنتج غير موجود." });
      return;
    }
    const changes = await db
      .select()
      .from(menaProductChanges)
      .where(and(
        eq(menaProductChanges.workspaceId, workspaceId),
        eq(menaProductChanges.productId, productId),
      ))
      .orderBy(desc(menaProductChanges.createdAt))
      .limit(200);
    res.json({ changes });
  },
);

router.get(
  "/social/products/change-proposals",
  requireWorkspace,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const statusFilter =
      typeof req.query.status === "string" &&
      ["proposed", "accepted", "rejected", "expired"].includes(req.query.status)
        ? (req.query.status as "proposed" | "accepted" | "rejected" | "expired")
        : null;
    const proposals = await db
      .select()
      .from(menaProductChangeProposals)
      .where(and(
        eq(menaProductChangeProposals.workspaceId, workspaceId),
        ...(statusFilter
          ? [eq(menaProductChangeProposals.status, statusFilter)]
          : []),
      ))
      .orderBy(desc(menaProductChangeProposals.createdAt))
      .limit(100);
    if (!proposals.length) {
      res.json({ proposals: [] });
      return;
    }
    const productIds = [...new Set(proposals.map((item) => item.productId))];
    const suggestionIds = [...new Set(proposals.map((item) => item.suggestionId))];
    const [productRows, suggestionRows] = await Promise.all([
      db
        .select({
          id: products.id,
          name: products.name,
          sku: products.sku,
          status: products.status,
        })
        .from(products)
        .where(and(
          eq(products.workspaceId, workspaceId),
          inArray(products.id, productIds),
        )),
      db
        .select({
          id: productExtractionSuggestions.id,
          evidence: productExtractionSuggestions.evidence,
          senderRole: productExtractionSuggestions.senderRole,
        })
        .from(productExtractionSuggestions)
        .where(and(
          eq(productExtractionSuggestions.workspaceId, workspaceId),
          inArray(productExtractionSuggestions.id, suggestionIds),
        )),
    ]);
    const productById = new Map(productRows.map((item) => [item.id, item]));
    const suggestionById = new Map(suggestionRows.map((item) => [item.id, item]));
    res.json({
      proposals: proposals.map((proposal) => ({
        id: proposal.id,
        productId: proposal.productId,
        suggestionId: proposal.suggestionId,
        diff: proposal.diff,
        status: proposal.status,
        createdAt: proposal.createdAt,
        decidedAt: proposal.decidedAt,
        product: productById.get(proposal.productId) ?? null,
        evidence: suggestionById.get(proposal.suggestionId)?.evidence ?? {},
        senderRole:
          suggestionById.get(proposal.suggestionId)?.senderRole ?? "unknown",
      })),
    });
  },
);

router.get(
  "/social/products/extraction-metrics",
  requireWorkspace,
  async (req, res) => {
    const workspaceId = requestWorkspaceId(req);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events = await db
      .select({
        event: menaProductExtractionEvents.event,
        total: sql<number>`count(*)::int`,
      })
      .from(menaProductExtractionEvents)
      .where(and(
        eq(menaProductExtractionEvents.workspaceId, workspaceId),
        gte(menaProductExtractionEvents.createdAt, since),
      ))
      .groupBy(menaProductExtractionEvents.event);
    const suggestions = await db
      .select({
        status: productExtractionSuggestions.status,
        classification: productExtractionSuggestions.classification,
        total: sql<number>`count(*)::int`,
      })
      .from(productExtractionSuggestions)
      .where(and(
        eq(productExtractionSuggestions.workspaceId, workspaceId),
        gte(productExtractionSuggestions.createdAt, since),
      ))
      .groupBy(
        productExtractionSuggestions.status,
        productExtractionSuggestions.classification,
      );
    const daily = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${menaProductExtractionEvents.createdAt}), 'YYYY-MM-DD')`,
        event: menaProductExtractionEvents.event,
        total: sql<number>`count(*)::int`,
      })
      .from(menaProductExtractionEvents)
      .where(and(
        eq(menaProductExtractionEvents.workspaceId, workspaceId),
        gte(menaProductExtractionEvents.createdAt, since),
        inArray(menaProductExtractionEvents.event, [
          "EXTRACTION_SUCCEEDED",
          "EXTRACTION_FAILED",
        ]),
      ))
      .groupBy(
        sql`date_trunc('day', ${menaProductExtractionEvents.createdAt})`,
        menaProductExtractionEvents.event,
      )
      .orderBy(sql`date_trunc('day', ${menaProductExtractionEvents.createdAt})`);
    // Why jobs ended the way they did, and which instruction produced which
    // answer. A count of failures without their reasons is a number you cannot
    // act on, and a prompt change with no version on the rows it produced cannot
    // be measured afterwards — both gaps were found by hand in the last audit.
    const failureReasons = await db
      .select({
        reasonCode: whatsappProductExtractionJobs.reasonCode,
        status: whatsappProductExtractionJobs.status,
        total: sql<number>`count(*)::int`,
      })
      .from(whatsappProductExtractionJobs)
      .where(and(
        eq(whatsappProductExtractionJobs.workspaceId, workspaceId),
        gte(whatsappProductExtractionJobs.updatedAt, since),
      ))
      .groupBy(
        whatsappProductExtractionJobs.reasonCode,
        whatsappProductExtractionJobs.status,
      )
      .orderBy(sql`count(*)::int desc`);
    const promptVersions = await db
      .select({
        promptVersion: productExtractionSuggestions.promptVersion,
        total: sql<number>`count(*)::int`,
      })
      .from(productExtractionSuggestions)
      .where(and(
        eq(productExtractionSuggestions.workspaceId, workspaceId),
        gte(productExtractionSuggestions.createdAt, since),
      ))
      .groupBy(productExtractionSuggestions.promptVersion);
    const countEvent = (name: string) =>
      events.find((item) => item.event === name)?.total ?? 0;
    const created = suggestions
      .filter((item) => item.classification === "product")
      .reduce((sum, item) => sum + item.total, 0);
    const activated = suggestions.find(
      (item) => item.status === "draft_created",
    )?.total ?? 0;
    res.json({
      events,
      suggestions,
      extractionSucceeded: countEvent("EXTRACTION_SUCCEEDED"),
      extractionFailed: countEvent("EXTRACTION_FAILED"),
      reprocessed: countEvent("EXTRACTION_REPROCESSED"),
      proposalsAccepted: countEvent("PROPOSAL_ACCEPTED"),
      conversionRate: created ? activated / created : 0,
      failureReasons: failureReasons.map((row) => ({
        ...row,
        // The merchant-facing sentence, so an operator reading this endpoint
        // does not need the code table at hand.
        message: row.reasonCode
          ? extractionReasonMessage(row.reasonCode)
          : "لم يُسجَّل سبب لهذا التشغيل.",
      })),
      promptVersions,
      daily,
    });
  },
);

export default router;
