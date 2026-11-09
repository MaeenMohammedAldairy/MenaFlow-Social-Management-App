import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaWhatsAppGroups,
  menaWhatsAppMessageMedia,
  menaInventoryMovements,
  menaWhatsAppMessages,
  productExtractionSources,
  productExtractionSuggestions,
  products,
} from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";

import { requestOwnerId } from "../lib/owner-access";

import { queueUnprocessedWhatsAppProductMessages } from "../lib/whatsapp-product-extraction";
import { normalizedProductName } from "../lib/product-utils.ts";
import { parseProductInput } from "../lib/product-validation";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();
import {
  mediaUrls,
  mediaRequestOrigin,
  type ProductMediaPreview,
  productMediaUrl,
  catalogProductResponse,
} from "./product-route-helpers";

router.get(
  "/social/products/whatsapp-extractions",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const suggestions = await db
      .select()
      .from(productExtractionSuggestions)
      .where(
        and(
          eq(productExtractionSuggestions.workspaceId, workspaceId),
          ne(productExtractionSuggestions.status, "dismissed"),
        ),
      )
      .orderBy(desc(productExtractionSuggestions.createdAt))
      .limit(50);
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
      suggestions: suggestions.map((suggestion) => ({
        ...suggestion,
        sources: sourcesBySuggestionId.get(suggestion.id) ?? [],
        ...(suggestion.status === "possible_duplicate"
          ? {
              possibleDuplicateProducts:
                duplicateProductsBySuggestionId.get(suggestion.id) ?? [],
            }
          : {}),
      })),
    });
  },
);

router.post(
  "/social/products/extract-whatsapp",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    try {
      const queuedMessages =
        await queueUnprocessedWhatsAppProductMessages(workspaceId);
      res.status(202).json({
        queuedMessages,
      });
    } catch (error) {
      console.error("Failed to queue WhatsApp product extraction", {
        workspaceId,
        reason: error instanceof Error ? error.message : "PRODUCT_QUEUE_FAILED",
      });
      res.status(500).json({
        error: "تعذر جدولة معالجة الرسائل. أعد المحاولة بعد قليل.",
      });
    }
  },
);

router.post(
  "/social/products/whatsapp-extractions/:id/create-draft",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
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
      }>;
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
              price:
                candidate.price && candidate.currency ? candidate.price : null,
              currency:
                candidate.price && candidate.currency
                  ? candidate.currency
                  : null,
              availability: candidate.availability ?? "unknown",
              status: "draft",
              mediaUrls: [],
            },
      );
      if (!input) return { status: "incomplete" as const };
      const { inventoryReason, ...productInput } = input;
      const sourceMedia = await transaction
        .select({ id: menaWhatsAppMessageMedia.id })
        .from(productExtractionSources)
        .innerJoin(
          menaWhatsAppMessageMedia,
          and(
            eq(
              menaWhatsAppMessageMedia.messageId,
              productExtractionSources.messageId,
            ),
            eq(
              menaWhatsAppMessageMedia.workspaceId,
              productExtractionSources.workspaceId,
            ),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
          ),
        )
        .where(
          and(
            eq(productExtractionSources.workspaceId, workspaceId),
            eq(productExtractionSources.suggestionId, suggestionId),
          ),
        )
        .orderBy(
          asc(menaWhatsAppMessageMedia.createdAt),
          asc(menaWhatsAppMessageMedia.mediaIndex),
        )
        .limit(20);
      const [product] = await transaction
        .insert(products)
        .values({
          id: randomUUID(),
          ownerId,
          workspaceId,
          ...productInput,
          availability:
            input.inventoryTracked && (input.stockOnHand ?? 0) <= 0
              ? "out_of_stock"
              : input.inventoryTracked
                ? "in_stock"
                : input.availability,
          mediaUrls: sourceMedia.map(({ id }) => id),
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
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
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
  "/social/products/whatsapp-extractions/:id/review",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
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

export default router;
