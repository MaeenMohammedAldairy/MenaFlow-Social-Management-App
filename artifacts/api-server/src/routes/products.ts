import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import express, { Router } from "express";
import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppGroupSelections,
  menaWhatsAppGroups,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  posts,
  productExtractionSources,
  productExtractionSuggestions,
  productPosts,
  products,
} from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";
import { PublicMediaUrlError } from "../lib/meta-media-url";
import {
  signedWhatsAppMediaUrl,
  verifySignedMediaRequest,
} from "../lib/meta-publishing";
import {
  createMediaThumbnail,
  resolveWhatsAppMediaStorageRoot,
  storeMediaObject,
  streamMediaObject,
  thumbnailObjectPath,
} from "../lib/whatsapp-media-storage";
import { requestOwnerId } from "../lib/owner-access";
import {
  extractWhatsAppProductCandidates,
  type ProductExtractionCandidate,
} from "../lib/product-extraction";
import {
  queueUnprocessedWhatsAppProductMessages,
} from "../lib/whatsapp-product-extraction";
import { normalizedProductName, workspaceMediaKey } from "../lib/product-utils.ts";
import {
  parseProductInput,
  publishedPostProductDraft,
  type ProductAvailability,
} from "../lib/product-validation";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();

function mediaUrls(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string")
    : [];
}

function mediaRequestOrigin(req: {
  protocol: string;
  get(name: string): string | undefined;
}): string | undefined {
  const host = req.get("host");
  return host ? `${req.protocol}://${host}` : undefined;
}

type ProductMediaPreview = {
  id: string;
  url: string;
  mediaType: string;
};

const PRODUCT_MEDIA_TYPES = {
  "image/jpeg": { mediaType: "image", extension: "jpg" },
  "image/png": { mediaType: "image", extension: "png" },
  "image/webp": { mediaType: "image", extension: "webp" },
  "image/heic": { mediaType: "image", extension: "heic" },
  "image/heif": { mediaType: "image", extension: "heif" },
  "video/mp4": { mediaType: "video", extension: "mp4" },
  "video/quicktime": { mediaType: "video", extension: "mov" },
} as const;

const PRODUCT_MEDIA_ID_PATTERN =
  /^product-media-(image|video)-([a-f0-9]{16})-([a-f0-9-]{36})-(jpg|png|webp|heic|heif|mp4|mov)$/;

function parseProductMediaId(value: string) {
  const match = PRODUCT_MEDIA_ID_PATTERN.exec(value);
  if (!match) return null;
  return {
    mediaType: match[1] as "image" | "video",
    workspaceKey: match[2],
    fileId: match[3],
    extension: match[4],
  };
}

function productMediaStoragePath(mediaId: string): string | null {
  const parsed = parseProductMediaId(mediaId);
  return parsed
    ? `product-media/${parsed.workspaceKey}/${parsed.fileId}.${parsed.extension}`
    : null;
}

function signedProductMediaUrl(
  mediaId: string,
  variant: "original" | "thumbnail",
  requestOrigin?: string,
): string | null {
  try {
    const url = new URL(
      signedWhatsAppMediaUrl(mediaId, true, variant, requestOrigin),
    );
    url.pathname = `/api/social/products/public-media/${encodeURIComponent(mediaId)}`;
    return url.toString();
  } catch (error) {
    if (error instanceof PublicMediaUrlError) return null;
    throw error;
  }
}

function productMediaUrl(
  mediaId: string,
  mediaType: string,
  requestOrigin?: string,
): string | null {
  try {
    return signedWhatsAppMediaUrl(
      mediaId,
      true,
      mediaType === "image" ? "thumbnail" : "original",
      requestOrigin,
    );
  } catch (error) {
    if (error instanceof PublicMediaUrlError) return null;
    throw error;
  }
}

function externalMediaPreview(url: string): ProductMediaPreview | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const mediaType = /\.(?:mp4|mov|webm)$/i.test(parsed.pathname)
      ? "video"
      : "image";
    return { id: url, url, mediaType };
  } catch {
    return null;
  }
}

async function productMediaPreviews(
  workspaceId: string,
  mediaIds: string[],
  requestOrigin?: string,
): Promise<ProductMediaPreview[]> {
  const productMediaPreviews = mediaIds.flatMap((id) => {
    const parsed = parseProductMediaId(id);
    if (!parsed || parsed.workspaceKey !== workspaceMediaKey(workspaceId)) {
      return [];
    }
    const url = signedProductMediaUrl(
      id,
      parsed.mediaType === "image" ? "thumbnail" : "original",
      requestOrigin,
    );
    return url ? [{ id, url, mediaType: parsed.mediaType }] : [];
  });
  const externalPreviews = mediaIds.flatMap((id) => {
    if (!/^https?:\/\//i.test(id)) return [];
    const preview = externalMediaPreview(id);
    return preview ? [preview] : [];
  });
  const storedIds = mediaIds.filter((id) => !/^https?:\/\//i.test(id));
  const storedMedia = storedIds.length
    ? await db
        .select({
          id: menaWhatsAppMessageMedia.id,
          mediaType: menaWhatsAppMessageMedia.mediaType,
        })
        .from(menaWhatsAppMessageMedia)
        .where(
          and(
            eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
            inArray(menaWhatsAppMessageMedia.id, storedIds),
          ),
        )
    : [];
  const storedPreviews = storedMedia.flatMap((media) => {
    const url = productMediaUrl(media.id, media.mediaType, requestOrigin);
    return url ? [{ id: media.id, url, mediaType: media.mediaType }] : [];
  });
  const previewById = new Map(
    [...externalPreviews, ...storedPreviews, ...productMediaPreviews].map(
      (preview) => [preview.id, preview],
    ),
  );
  return mediaIds.flatMap((id) => {
    const preview = previewById.get(id);
    return preview ? [preview] : [];
  });
}

async function catalogProductResponse(
  product: typeof products.$inferSelect,
  workspaceId: string,
  postIds: string[] = [],
  requestOrigin?: string,
) {
  const productMediaUrls = [...new Set(mediaUrls(product.mediaUrls))].slice(
    0,
    20,
  );
  return {
    ...product,
    mediaUrls: productMediaUrls,
    mediaPreviews: await productMediaPreviews(
      workspaceId,
      productMediaUrls,
      requestOrigin,
    ),
    postIds,
  };
}

router.get("/social/products/public-media/:mediaId", async (req, res) => {
  const mediaId = metaString(req.params.mediaId);
  const parsed = mediaId ? parseProductMediaId(mediaId) : null;
  const expires =
    typeof req.query.expires === "string" ? req.query.expires : "";
  const signature =
    typeof req.query.signature === "string" ? req.query.signature : "";
  const variant = req.query.variant === "thumbnail" ? "thumbnail" : "original";
  if (
    !mediaId ||
    !parsed ||
    !verifySignedMediaRequest(mediaId, expires, signature, variant) ||
    (variant === "thumbnail" && parsed.mediaType !== "image")
  ) {
    res.status(403).json({ error: "رابط الوسائط غير صالح أو منتهي الصلاحية." });
    return;
  }

  const relativePath = productMediaStoragePath(mediaId);
  if (!relativePath) {
    res.status(404).json({ error: "ملف الوسائط غير متاح." });
    return;
  }
  const storagePath =
    variant === "thumbnail" ? thumbnailObjectPath(relativePath) : relativePath;
  const mimeType =
    variant === "thumbnail"
      ? "image/webp"
      : (Object.entries(PRODUCT_MEDIA_TYPES).find(
          ([, value]) => value.extension === parsed.extension,
        )?.[0] ?? "application/octet-stream");

  if (process.env.SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const storedObject = await streamMediaObject(storagePath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    if (storedObject.contentLength) {
      res.setHeader("Content-Length", storedObject.contentLength);
    }
    storedObject.stream.pipe(res);
    return;
  }

  const root = resolveWhatsAppMediaStorageRoot();
  const resolvedPath = path.resolve(root, storagePath);
  if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("INVALID_PRODUCT_MEDIA_PATH");
  }
  try {
    const file = await readFile(resolvedPath);
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      res.status(404).json({ error: "ملف الوسائط غير متاح." });
      return;
    }
    throw error;
  }
});

router.post(
  "/social/products/media",
  requireWorkspace,
  express.raw({ type: ["image/*", "video/*"], limit: "20mb" }),
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const mimeType = req.get("content-type")?.split(";", 1)[0].toLowerCase();
    const mediaConfig =
      mimeType && mimeType in PRODUCT_MEDIA_TYPES
        ? PRODUCT_MEDIA_TYPES[mimeType as keyof typeof PRODUCT_MEDIA_TYPES]
        : null;
    if (
      !Buffer.isBuffer(req.body) ||
      !mimeType ||
      !mediaConfig ||
      req.body.length === 0
    ) {
      res.status(400).json({ error: "نوع ملف الوسائط غير مدعوم." });
      return;
    }

    let thumbnail: Buffer | null = null;
    if (mediaConfig.mediaType === "image") {
      try {
        thumbnail = await createMediaThumbnail(req.body);
      } catch {
        res.status(400).json({ error: "تعذّر قراءة ملف الصورة." });
        return;
      }
    } else if (
      req.body.length < 12 ||
      req.body.toString("ascii", 4, 8) !== "ftyp"
    ) {
      res.status(400).json({ error: "ملف الفيديو غير صالح." });
      return;
    }

    const workspaceKey = workspaceMediaKey(workspaceId);
    const fileId = randomUUID();
    const mediaId = `product-media-${mediaConfig.mediaType}-${workspaceKey}-${fileId}-${mediaConfig.extension}`;
    const objectPath = productMediaStoragePath(mediaId);
    if (!objectPath) throw new Error("PRODUCT_MEDIA_ID_INVALID");
    const provider = await storeMediaObject(objectPath, req.body, mimeType);
    if (provider === "local") {
      const root = resolveWhatsAppMediaStorageRoot();
      const originalPath = path.resolve(root, objectPath);
      if (!originalPath.startsWith(`${root}${path.sep}`)) {
        throw new Error("INVALID_PRODUCT_MEDIA_PATH");
      }
      await mkdir(path.dirname(originalPath), { recursive: true });
      await writeFile(originalPath, req.body);
    }
    if (thumbnail) {
      const thumbnailPath = thumbnailObjectPath(objectPath);
      const thumbnailProvider = await storeMediaObject(
        thumbnailPath,
        thumbnail,
        "image/webp",
      );
      if (thumbnailProvider === "local") {
        const root = resolveWhatsAppMediaStorageRoot();
        const resolvedPath = path.resolve(root, thumbnailPath);
        if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
          throw new Error("INVALID_PRODUCT_MEDIA_PATH");
        }
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, thumbnail);
      }
    }

    res.status(201).json({
      media: {
        id: mediaId,
        mediaType: mediaConfig.mediaType,
        mediaPreview:
          (
            await productMediaPreviews(
              workspaceId,
              [mediaId],
              mediaRequestOrigin(req),
            )
          )[0] ?? null,
      },
    });
  },
);

router.get("/social/products", requireWorkspace, async (req, res) => {
  if (!requestOwnerId(req)) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const requestOrigin = mediaRequestOrigin(req);
  const includeArchived = req.query.includeArchived === "true";
  const rows = await db
    .select({ product: products, postId: productPosts.postId })
    .from(products)
    .leftJoin(
      productPosts,
      and(
        eq(productPosts.workspaceId, products.workspaceId),
        eq(productPosts.productId, products.id),
      ),
    )
    .where(
      includeArchived
        ? eq(products.workspaceId, workspaceId)
        : and(
            eq(products.workspaceId, workspaceId),
            ne(products.status, "archived"),
          ),
    )
    .orderBy(desc(products.updatedAt));
  const grouped = new Map<
    string,
    { product: (typeof rows)[number]["product"]; postIds: string[] }
  >();
  for (const row of rows) {
    const current = grouped.get(row.product.id) ?? {
      product: row.product,
      postIds: [],
    };
    if (row.postId) current.postIds.push(row.postId);
    grouped.set(row.product.id, current);
  }
  res.json({
    products: await Promise.all(
      [...grouped.values()].map(({ product, postIds }) =>
        catalogProductResponse(product, workspaceId, postIds, requestOrigin),
      ),
    ),
  });
});

router.get(
  "/social/products/post-candidates",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const candidates = await db
      .select({
        id: posts.id,
        title: posts.title,
        body: posts.body,
        mediaUrls: posts.mediaUrls,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .leftJoin(
        productPosts,
        and(
          eq(productPosts.workspaceId, posts.workspaceId),
          eq(productPosts.postId, posts.id),
        ),
      )
      .where(
        and(
          eq(posts.workspaceId, workspaceId),
          or(
            eq(posts.status, "published"),
            sql`${posts.publishResults}->'facebook'->>'status' = 'published'`,
            sql`${posts.publishResults}->'instagram'->>'status' = 'published'`,
          ),
          isNull(productPosts.productId),
        ),
      )
      .orderBy(desc(posts.updatedAt))
      .limit(50);
    const requestOrigin = mediaRequestOrigin(req);
    res.json({
      candidates: await Promise.all(
        candidates
          .filter((post) => post.title.trim() || post.body.trim())
          .map(async (post) => {
            const postMediaUrls = mediaUrls(post.mediaUrls);
            return {
              ...post,
              mediaUrls: postMediaUrls,
              mediaPreviews: await productMediaPreviews(
                workspaceId,
                postMediaUrls,
                requestOrigin,
              ),
              updatedAt: post.updatedAt.toISOString(),
            };
          }),
      ),
    });
  },
);

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
              inArray(
                menaWhatsAppMessageMedia.messageId,
                [...new Set(sourceRows.map(({ messageId }) => messageId))],
              ),
            ),
          )
          .orderBy(
            asc(menaWhatsAppMessageMedia.createdAt),
            asc(menaWhatsAppMessageMedia.mediaIndex),
          )
      : [];
    const requestOrigin = mediaRequestOrigin(req);
    const sourceMediaByMessageId = new Map<
      string,
      ProductMediaPreview[]
    >();
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
          ...input,
          mediaUrls: sourceMedia.map(({ id }) => id),
          verifiedAt: null,
          updatedAt: new Date(),
        })
        .returning();
      if (!product) throw new Error("PRODUCT_EXTRACTION_DRAFT_CREATE_FAILED");
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
  const [created] = await db
    .insert(products)
    .values({
      id: randomUUID(),
      ownerId,
      workspaceId,
      ...input,
      verifiedAt: input.status === "active" ? new Date() : null,
      updatedAt: new Date(),
    })
    .returning();
  res.status(201).json({
    product: await catalogProductResponse(
      created,
      workspaceId,
      [],
      mediaRequestOrigin(req),
    ),
    postIds: [],
  });
});

router.put("/social/products/:id", requireWorkspace, async (req, res) => {
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
  const input = parseProductInput(req.body);
  if (!input) {
    res.status(400).json({ error: "تحقق من بيانات المنتج المدخلة." });
    return;
  }
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
  const [updated] = await db
    .update(products)
    .set({
      ...input,
      verifiedAt: input.status === "active" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(products.id, productId), eq(products.workspaceId, workspaceId)),
    )
    .returning();
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
      if (post.title !== sourcePost.title || post.body !== sourcePost.body) {
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
          mediaUrls: mediaUrls(post.mediaUrls),
        },
        extractedProduct,
      );
      if (!draft) return { status: "missing" as const };
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
