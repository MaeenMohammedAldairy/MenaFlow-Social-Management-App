import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaInventoryMovements,
  posts,
  productPosts,
  products,
} from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";

import { requestOwnerId } from "../lib/owner-access";
import {
  extractWhatsAppProductCandidates,
  type ProductExtractionCandidate,
} from "../lib/product-extraction";
import { storeMetaPostImage } from "../lib/meta-post-media";

import {
  parseProductInput,
  publishedPostProductDraft,
} from "../lib/product-validation";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { notifyPostsChanged } from "../lib/post-events";

const router = Router();
import {
  mediaUrls,
  mediaRequestOrigin,
  catalogProductResponse,
} from "./product-route-helpers";

type ImportedMetaPost = {
  platform: "facebook" | "instagram";
  id: string;
  text: string;
  publishedAt: Date | null;
  url: string | null;
  imageUrl: string | null;
  mediaType: string | null;
};

function parseImportedMetaPost(
  value: unknown,
): ImportedMetaPost | null | false {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  const postUrlValue = input.url;
  const imageUrlValue = input.imageUrl;
  const mediaTypeValue = input.mediaType;
  if (
    (input.platform !== "facebook" && input.platform !== "instagram") ||
    typeof input.id !== "string" ||
    !input.id.trim() ||
    input.id.length > 500 ||
    typeof input.text !== "string" ||
    input.text.length > 6000 ||
    (input.publishedAt !== null && typeof input.publishedAt !== "string") ||
    (postUrlValue !== null && typeof postUrlValue !== "string") ||
    (imageUrlValue !== null && typeof imageUrlValue !== "string") ||
    (mediaTypeValue !== undefined &&
      mediaTypeValue !== null &&
      (typeof mediaTypeValue !== "string" || mediaTypeValue.length > 50))
  ) {
    return false;
  }
  const publishedAt =
    typeof input.publishedAt === "string" ? new Date(input.publishedAt) : null;
  if (publishedAt && Number.isNaN(publishedAt.getTime())) return false;
  const parseHttpsUrl = (value: string | null): string | null | false => {
    if (value === null) return null;
    if (value.length > 2048) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" ? url.toString() : false;
    } catch {
      return false;
    }
  };
  const url = parseHttpsUrl(
    typeof postUrlValue === "string" ? postUrlValue : null,
  );
  const imageUrl = parseHttpsUrl(
    typeof imageUrlValue === "string" ? imageUrlValue : null,
  );
  if (url === false || imageUrl === false) return false;
  if (imageUrl) {
    const host = new URL(imageUrl).hostname.toLowerCase();
    if (
      host !== "fbcdn.net" &&
      !host.endsWith(".fbcdn.net") &&
      host !== "cdninstagram.com" &&
      !host.endsWith(".cdninstagram.com") &&
      host !== "fbsbx.com" &&
      !host.endsWith(".fbsbx.com")
    ) {
      return false;
    }
  }
  return {
    platform: input.platform,
    id: input.id.trim(),
    text: input.text,
    publishedAt,
    url,
    imageUrl,
    mediaType: typeof mediaTypeValue === "string" ? mediaTypeValue : null,
  };
}

router.post(
  "/social/products/extract-scanned-post",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const text = metaString(req.body?.text)?.trim() ?? "";
    const platform = req.body?.platform;
    const postId = metaString(req.body?.postId)?.trim() ?? "";
    if (!text || text.length > 6000) {
      res.status(400).json({
        error: text
          ? "نص المنشور أطول من الحد المسموح للاستخراج."
          : "المنشور لا يحتوي على نص قابل للاستخراج.",
      });
      return;
    }
    if (
      (platform !== "facebook" && platform !== "instagram") ||
      !postId ||
      postId.length > 500
    ) {
      res.status(400).json({ error: "بيانات المنشور غير صالحة للاستخراج." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    try {
      const extraction = await extractWhatsAppProductCandidates(workspaceId, [
        {
          id: `${platform}:${postId}`,
          groupId: `${platform}:${postId}`,
          messageTimestamp: null,
          replyToMessageId: null,
          text,
        },
      ]);
      const candidate = extraction.candidates.find(
        (item) => item.classification === "product",
      );
      res.json({
        classification: candidate ? "product" : "not_product",
        extractedData: candidate?.data ?? null,
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "AI_EXTRACTION_FAILED";
      console.error("Scanned post product extraction failed", {
        workspaceId,
        reason,
      });
      const configurationMissing = reason.startsWith("MISSING_");
      const reasonCode = /^[A-Z][A-Z0-9_.:-]{0,99}$/.test(reason)
        ? reason
        : "AI_EXTRACTION_FAILED";
      const message = configurationMissing
        ? "خدمة الذكاء الاصطناعي غير مهيأة. أضف مفتاح OpenAI أو Gemini إلى إعدادات الخادم."
        : /HTTP_(401|403)/.test(reason)
          ? "رفض مزود الذكاء الاصطناعي المفتاح أو صلاحية النموذج."
          : /HTTP_429/.test(reason)
            ? "تجاوز مزود الذكاء الاصطناعي حد الاستخدام أو الطلبات."
            : /HTTP_5\d\d/.test(reason)
              ? "مزود الذكاء الاصطناعي غير متاح مؤقتًا. أعد المحاولة بعد قليل."
              : /fetch failed|NETWORK|TIMEOUT|TimeoutError/i.test(reason)
                ? "تعذر اتصال الخادم بمزود الذكاء الاصطناعي."
                : reason.startsWith("PRODUCT_EXTRACTION_")
                  ? "تعذر التحقق من بيانات الاستخراج التي أعادها مزود الذكاء الاصطناعي."
                  : "تعذر استخراج بيانات المنتج. أعد المحاولة.";
      res.status(configurationMissing ? 503 : 502).json({
        error: `${message} (رمز الخطأ: ${reasonCode})`,
      });
    }
  },
);

router.get(
  "/social/products/:id/inventory-movements",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const productId = metaString(req.params.id);
    if (!productId) {
      res.status(400).json({ error: "معرّف المنتج غير صالح." });
      return;
    }
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!product) {
      res.status(404).json({ error: "لم يتم العثور على المنتج." });
      return;
    }
    const movements = await db
      .select({
        id: menaInventoryMovements.id,
        type: menaInventoryMovements.type,
        stockDelta: menaInventoryMovements.stockDelta,
        reservedDelta: menaInventoryMovements.reservedDelta,
        reason: menaInventoryMovements.reason,
        createdAt: menaInventoryMovements.createdAt,
      })
      .from(menaInventoryMovements)
      .where(
        and(
          eq(menaInventoryMovements.workspaceId, workspaceId),
          eq(menaInventoryMovements.productId, productId),
        ),
      )
      .orderBy(desc(menaInventoryMovements.createdAt))
      .limit(20);
    res.json({ movements });
  },
);

router.post("/social/products", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const input = parseProductInput(req.body);
  if (!input) {
    res.status(400).json({ error: "تحقق من بيانات المنتج المدخلة." });
    return;
  }
  const importedMetaPost = parseImportedMetaPost(req.body?.importedMetaPost);
  if (importedMetaPost === false) {
    res.status(400).json({ error: "بيانات المنشور المستورد غير صالحة." });
    return;
  }
  const { inventoryReason, ...productInput } = input;
  if (
    importedMetaPost?.imageUrl &&
    !productInput.mediaUrls.includes(importedMetaPost.imageUrl) &&
    productInput.mediaUrls.length >= 20
  ) {
    res.status(400).json({
      error: "يمكن إرفاق 20 وسيطًا كحد أقصى للمنتج.",
    });
    return;
  }
  if (input.sku) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(eq(products.workspaceId, workspaceId), eq(products.sku, input.sku)),
      )
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ error: "رقم المنتج مستخدم بالفعل في مساحة العمل." });
      return;
    }
  }
  let importedMediaId: string | null = null;
  if (importedMetaPost?.imageUrl) {
    try {
      importedMediaId = await storeMetaPostImage(
        workspaceId,
        importedMetaPost.imageUrl,
      );
    } catch (error) {
      console.error("Unable to store imported Meta post media", {
        workspaceId,
        platform: importedMetaPost.platform,
        postId: importedMetaPost.id,
        reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
      res.status(502).json({
        error:
          "تعذّر حفظ صورة المنشور في مساحة العمل. حدّث بيانات المنشور ثم أعد المحاولة.",
      });
      return;
    }
  }
  const productMediaUrls = new Set(productInput.mediaUrls);
  if (importedMetaPost?.imageUrl && importedMediaId) {
    productMediaUrls.delete(importedMetaPost.imageUrl);
    productMediaUrls.add(importedMediaId);
  }
  const normalizedProductInput = {
    ...productInput,
    mediaUrls: [...productMediaUrls],
  };
  const created = await db.transaction(async (transaction) => {
    const now = new Date();
    const [product] = await transaction
      .insert(products)
      .values({
        id: randomUUID(),
        ownerId,
        workspaceId,
        ...normalizedProductInput,
        availability:
          input.inventoryTracked && (input.stockOnHand ?? 0) <= 0
            ? "out_of_stock"
            : input.inventoryTracked
              ? "in_stock"
              : input.availability,
        verifiedAt: input.status === "active" ? now : null,
        updatedAt: now,
      })
      .returning();
    if (product.stockOnHand > 0) {
      await transaction.insert(menaInventoryMovements).values({
        id: randomUUID(),
        workspaceId,
        productId: product.id,
        actorId: ownerId,
        type: "opening_balance",
        stockDelta: product.stockOnHand,
        reason: inventoryReason || "رصيد افتتاحي",
        createdAt: now,
      });
    }
    let importedPostId: string | null = null;
    if (importedMetaPost) {
      const [existingPublishedPost] = await transaction
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.workspaceId, workspaceId),
            or(
              and(
                sql`${posts.publishResults}->${importedMetaPost.platform}->>'postId' = ${importedMetaPost.id}`,
                sql`${posts.publishResults}->${importedMetaPost.platform}->>'status' = 'published'`,
              ),
              and(
                eq(posts.sourceType, "meta_import"),
                sql`${posts.metadata}->>'externalPlatform' = ${importedMetaPost.platform}`,
                sql`${posts.metadata}->>'externalPostId' = ${importedMetaPost.id}`,
              ),
            ),
          ),
        )
        .limit(1);
      importedPostId = existingPublishedPost?.id ?? null;
      if (importedPostId && importedMediaId) {
        await transaction
          .update(posts)
          .set({ mediaUrls: [importedMediaId], updatedAt: now })
          .where(
            and(
              eq(posts.id, importedPostId),
              eq(posts.workspaceId, workspaceId),
            ),
          );
      }
      if (!importedPostId) {
        importedPostId = `meta-import-${createHash("sha256")
          .update(
            `${workspaceId}\0${importedMetaPost.platform}\0${importedMetaPost.id}`,
          )
          .digest("hex")}`;
        const [importedPost] = await transaction
          .insert(posts)
          .values({
            id: importedPostId,
            ownerId,
            workspaceId,
            title:
              importedMetaPost.text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find(Boolean)
                ?.slice(0, 120) ?? "",
            body: importedMetaPost.text,
            channels: [importedMetaPost.platform],
            status: "published",
            sourceType: "meta_import",
            sourceMessageDate: importedMetaPost.publishedAt,
            mediaUrls: importedMediaId ? [importedMediaId] : [],
            metadata: {
              importedFromMeta: true,
              externalPlatform: importedMetaPost.platform,
              externalPostId: importedMetaPost.id,
              permalinkUrl: importedMetaPost.url,
              mediaType: importedMetaPost.mediaType,
            },
            publishResults: {
              [importedMetaPost.platform]: {
                status: "published",
                postId: importedMetaPost.id,
                permalink: importedMetaPost.url,
                imported: true,
              },
            },
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: posts.id });
        if (!importedPost) {
          const [existingImportedPost] = await transaction
            .select({ id: posts.id })
            .from(posts)
            .where(
              and(
                eq(posts.id, importedPostId),
                eq(posts.workspaceId, workspaceId),
                eq(posts.sourceType, "meta_import"),
              ),
            )
            .limit(1);
          if (!existingImportedPost) {
            throw new Error("IMPORTED_META_POST_CONFLICT");
          }
        }
      }
      await transaction.insert(productPosts).values({
        workspaceId,
        productId: product.id,
        postId: importedPostId,
      });
    }
    return { product, importedPostId };
  });
  if (created.importedPostId) notifyPostsChanged(ownerId);
  res.status(201).json({
    product: await catalogProductResponse(
      created.product,
      workspaceId,
      created.importedPostId ? [created.importedPostId] : [],
      mediaRequestOrigin(req),
    ),
    postIds: created.importedPostId ? [created.importedPostId] : [],
  });
});

router.put("/social/products/:id", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const productId = metaString(req.params.id);
  if (!productId) {
    res.status(400).json({ error: "معرّف المنتج غير صالح." });
    return;
  }
  const input = parseProductInput(req.body);
  if (!input) {
    res.status(400).json({ error: "تحقق من بيانات المنتج المدخلة." });
    return;
  }
  const { inventoryReason, ...productInput } = input;
  if (input.sku) {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.workspaceId, workspaceId),
          eq(products.sku, input.sku),
          ne(products.id, productId),
        ),
      )
      .limit(1);
    if (existing) {
      res
        .status(409)
        .json({ error: "رقم المنتج مستخدم بالفعل في مساحة العمل." });
      return;
    }
  }
  const updateResult = await db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!current) return { error: "NOT_FOUND" as const };
    const nextStock = input.stockOnHand ?? current.stockOnHand;
    const nextTracking = input.inventoryTracked ?? current.inventoryTracked;
    if (
      nextStock < current.stockReserved ||
      (!nextTracking && current.stockReserved > 0)
    ) {
      return { error: "RESERVED_STOCK" as const };
    }
    const now = new Date();
    const [updated] = await transaction
      .update(products)
      .set({
        ...productInput,
        availability: nextTracking
          ? nextStock > current.stockReserved
            ? "in_stock"
            : "out_of_stock"
          : input.availability,
        stockOnHand: nextStock,
        inventoryTracked: nextTracking,
        verifiedAt: input.status === "active" ? now : null,
        updatedAt: now,
      })
      .where(
        and(eq(products.id, productId), eq(products.workspaceId, workspaceId)),
      )
      .returning();
    const stockDelta = nextStock - current.stockOnHand;
    if (stockDelta !== 0) {
      await transaction.insert(menaInventoryMovements).values({
        id: randomUUID(),
        workspaceId,
        productId,
        actorId: ownerId,
        type: "adjustment",
        stockDelta,
        reason: inventoryReason || "تعديل من كتالوج المنتجات",
        createdAt: now,
      });
    }
    return { product: updated };
  });
  if ("error" in updateResult) {
    if (updateResult.error === "NOT_FOUND") {
      res.status(404).json({ error: "لم يتم العثور على المنتج." });
      return;
    }
    res.status(409).json({
      error: "لا يمكن أن يكون المخزون أقل من الكمية المحجوزة للطلبات.",
    });
    return;
  }
  const updated = updateResult.product;
  if (!updated) {
    res.status(404).json({ error: "لم يتم العثور على المنتج." });
    return;
  }
  const linkedPosts = await db
    .select({ postId: productPosts.postId })
    .from(productPosts)
    .where(
      and(
        eq(productPosts.workspaceId, workspaceId),
        eq(productPosts.productId, updated.id),
      ),
    );
  res.json({
    product: await catalogProductResponse(
      updated,
      workspaceId,
      linkedPosts.map(({ postId }) => postId),
      mediaRequestOrigin(req),
    ),
    postIds: linkedPosts.map(({ postId }) => postId),
  });
});

router.post(
  "/social/products/import-post/:postId",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const postId = metaString(req.params.postId);
    if (!postId) {
      res.status(400).json({ error: "معرّف المنشور غير صالح." });
      return;
    }
    const [sourcePost] = await db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.workspaceId, workspaceId),
          or(
            eq(posts.status, "published"),
            sql`${posts.publishResults}->'facebook'->>'status' = 'published'`,
            sql`${posts.publishResults}->'instagram'->>'status' = 'published'`,
          ),
        ),
      )
      .limit(1);
    if (!sourcePost) {
      res.status(404).json({ error: "المنشور غير متاح للاستيراد." });
      return;
    }

    const sourceMediaUrls = mediaUrls(sourcePost.mediaUrls);
    let importedMediaUrls = sourceMediaUrls;
    if (sourcePost.sourceType === "meta_import") {
      try {
        importedMediaUrls = await Promise.all(
          sourceMediaUrls.map((url) =>
            /^https?:\/\//i.test(url)
              ? storeMetaPostImage(workspaceId, url)
              : url,
          ),
        );
      } catch (error) {
        console.error("Unable to store published Meta post media", {
          workspaceId,
          postId,
          reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
        });
        res.status(502).json({
          error:
            "تعذّر حفظ وسائط المنشور في مساحة العمل. حدّث بيانات المنشور ثم أعد المحاولة.",
        });
        return;
      }
    }

    let extractedProduct: ProductExtractionCandidate | undefined;
    const sourceText = [sourcePost.title, sourcePost.body]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n");
    if (sourceText) {
      try {
        const extraction = await extractWhatsAppProductCandidates(workspaceId, [
          {
            id: sourcePost.id,
            groupId: `post:${sourcePost.id}`,
            messageTimestamp: sourcePost.updatedAt.toISOString(),
            replyToMessageId: null,
            text: sourceText,
          },
        ]);
        extractedProduct = extraction.candidates.find(
          (candidate) => candidate.classification === "product",
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "AI_EXTRACTION_FAILED";
        console.error("Published post product extraction failed", {
          workspaceId,
          postId,
          reason,
        });
        const configurationMissing = reason.startsWith("MISSING_");
        const reasonCode = /^[A-Z][A-Z0-9_.:-]{0,99}$/.test(reason)
          ? reason
          : "AI_EXTRACTION_FAILED";
        const message = configurationMissing
          ? "خدمة الذكاء الاصطناعي غير مهيأة. أضف مفتاح OpenAI أو Gemini إلى إعدادات الخادم ثم أعد تشغيله."
          : /HTTP_(401|403)/.test(reason)
            ? "رفض مزود الذكاء الاصطناعي المفتاح أو صلاحية النموذج. تحقق من إعدادات المفتاح والنموذج في الخادم."
            : /HTTP_429/.test(reason)
              ? "تجاوز مزود الذكاء الاصطناعي حد الاستخدام أو الطلبات. تحقق من الحصة أو الرصيد ثم أعد المحاولة."
              : /HTTP_5\d\d/.test(reason)
                ? "مزود الذكاء الاصطناعي غير متاح مؤقتًا. أعد المحاولة بعد قليل."
                : /fetch failed|NETWORK|TIMEOUT|TimeoutError/i.test(reason)
                  ? "تعذر اتصال الخادم بمزود الذكاء الاصطناعي. تحقق من اتصال الخادم بالإنترنت."
                  : reason.startsWith("PRODUCT_EXTRACTION_")
                    ? "أعاد مزود الذكاء الاصطناعي بيانات غير مكتملة أو بصيغة غير صالحة. راجع سجل الخادم أو جرّب نموذجًا آخر."
                    : "تعذر استخراج بيانات المنتج. راجع سجل api-server لمعرفة رمز الخطأ ثم أعد المحاولة.";
        res.status(configurationMissing ? 503 : 502).json({
          error: `${message} (رمز الخطأ: ${reasonCode})`,
        });
        return;
      }
    }
    const imported = await db.transaction(async (transaction) => {
      const [post] = await transaction
        .select()
        .from(posts)
        .where(
          and(
            eq(posts.id, postId),
            eq(posts.workspaceId, workspaceId),
            or(
              eq(posts.status, "published"),
              sql`${posts.publishResults}->'facebook'->>'status' = 'published'`,
              sql`${posts.publishResults}->'instagram'->>'status' = 'published'`,
            ),
          ),
        )
        .for("update")
        .limit(1);
      if (!post) return { status: "missing" as const };
      if (
        post.title !== sourcePost.title ||
        post.body !== sourcePost.body ||
        JSON.stringify(mediaUrls(post.mediaUrls)) !==
          JSON.stringify(sourceMediaUrls)
      ) {
        return { status: "changed" as const };
      }
      const [existing] = await transaction
        .select({ productId: productPosts.productId })
        .from(productPosts)
        .where(
          and(
            eq(productPosts.workspaceId, workspaceId),
            eq(productPosts.postId, post.id),
          ),
        )
        .limit(1);
      if (existing) return { status: "imported" as const };

      const draft = publishedPostProductDraft(
        {
          title: post.title,
          body: post.body,
          mediaUrls: importedMediaUrls,
        },
        extractedProduct,
      );
      if (!draft) return { status: "missing" as const };
      if (
        JSON.stringify(sourceMediaUrls) !== JSON.stringify(importedMediaUrls)
      ) {
        await transaction
          .update(posts)
          .set({ mediaUrls: importedMediaUrls, updatedAt: new Date() })
          .where(
            and(eq(posts.id, post.id), eq(posts.workspaceId, workspaceId)),
          );
      }
      const id = randomUUID();
      const [product] = await transaction
        .insert(products)
        .values({
          id,
          ownerId,
          workspaceId,
          ...draft,
          verifiedAt: draft.status === "active" ? new Date() : null,
          updatedAt: new Date(),
        })
        .returning();
      if (!product) throw new Error("PRODUCT_IMPORT_FAILED");
      await transaction.insert(productPosts).values({
        workspaceId,
        productId: id,
        postId: post.id,
      });
      return { status: "created" as const, product };
    });
    if (imported.status === "missing") {
      res.status(404).json({ error: "المنشور غير متاح للاستيراد." });
      return;
    }
    if (imported.status === "changed") {
      res.status(409).json({
        error:
          "تغير نص المنشور أثناء استخراجه. أعد المحاولة لاستيراد أحدث نسخة.",
      });
      return;
    }
    if (imported.status === "imported") {
      res
        .status(409)
        .json({ error: "تمت إضافة هذا المنشور إلى كتالوج المنتجات مسبقًا." });
      return;
    }
    notifyPostsChanged(ownerId);
    res.status(201).json({
      product: await catalogProductResponse(
        imported.product,
        workspaceId,
        [postId],
        mediaRequestOrigin(req),
      ),
      postIds: [postId],
    });
  },
);

export default router;
