import {
  fetchApiResponse,
  readJsonResponse,
} from "@workspace/api-client-react";

export type ImportedMetaPost = {
  platform: "facebook" | "instagram";
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
  imageUrl: string | null;
  mediaType?: string | null;
};

export type CatalogProduct = {
  id: string;
  sku: string | null;
  name: string;
  aliases: string[];
  description: string;
  price: string | null;
  currency: string | null;
  availability: "unknown" | "in_stock" | "out_of_stock" | "preorder";
  inventoryTracked: boolean;
  stockOnHand: number;
  stockReserved: number;
  lowStockThreshold: number;
  status: "draft" | "active" | "archived";
  mediaUrls: string[];
  mediaPreviews: Array<{
    id: string;
    url: string;
    mediaType: string;
  }>;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  postIds: string[];
  publicationHistory?: ProductPublicationHistory[];
  /** Field keys the merchant still has to fill. */
  missingFields?: ProductFieldKey[];
  /** Arabic labels for `missingFields`, ready to render. */
  missingFieldMessages?: string[];
  /** Missing fields that stop publication. */
  publicationBlockers?: ProductFieldKey[];
  publicationBlockerMessages?: string[];
  publicationBlocked?: boolean;
  advisoryFields?: ProductFieldKey[];
};

export type ProductFieldKey =
  | "name"
  | "description"
  | "price"
  | "currency"
  | "availability"
  | "media";

export type ProductPublicationHistory = {
  channel: "facebook" | "instagram";
  accountId: string;
  permalink: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type InventoryMovement = {
  id: string;
  type:
    "opening_balance" | "adjustment" | "reservation" | "release" | "shipment";
  stockDelta: number;
  reservedDelta: number;
  reason: string;
  createdAt: string;
};

export type ProductCandidate = {
  id: string;
  title: string;
  body: string;
  mediaUrls: string[];
  mediaPreviews: CatalogProduct["mediaPreviews"];
  updatedAt: string;
};

export type ProductExtractionSuggestion = {
  id: string;
  classification: "product" | "not_product";
  extractedData: {
    name: string | null;
    sku: string | null;
    aliases: string[];
    description: string | null;
    price: string | null;
    currency: string | null;
    availability: "in_stock" | "out_of_stock" | "preorder" | null;
  };
  evidence: Record<string, string | null>;
  confidence: Record<string, number>;
  fieldReview: Record<string, boolean>;
  /** Field keys still empty in this suggestion. */
  missingFields?: ProductFieldKey[];
  missingFieldMessages?: string[];
  aiModel: string;
  status: "review" | "draft_created" | "possible_duplicate";
  productId: string | null;
  possibleDuplicateProducts?: Array<{
    id: string;
    name: string;
    sku: string | null;
    status: string;
    description: string;
    price: string | null;
    currency: string | null;
    availability: string;
  }>;
  createdAt: string;
  sources: Array<{
    id: string;
    text: string;
    senderName: string | null;
    messageTimestamp: string | null;
    groupName: string | null;
    mediaPreviews: CatalogProduct["mediaPreviews"];
  }>;
};

export type ScannedPostProductExtraction = {
  classification: "product" | "not_product";
  extractedData: {
    name: string | null;
    sku: string | null;
    aliases: string[];
    description: string | null;
    price: string | null;
    currency: string | null;
    availability: "in_stock" | "out_of_stock" | "preorder" | null;
  } | null;
};

export type ProductInput = Omit<
  CatalogProduct,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "verifiedAt"
  | "postIds"
  | "mediaPreviews"
  | "inventoryTracked"
  | "stockOnHand"
  | "stockReserved"
  | "lowStockThreshold"
> & {
  inventoryTracked?: boolean;
  stockOnHand?: number;
  lowStockThreshold?: number;
  inventoryReason?: string;
};

export type PublishableAccount = {
  channel: "facebook" | "instagram";
  accountId: string;
  accountName: string;
  authorizationStatus: string;
  authorizationReason: string | null;
};

export type ProductPublicationJob = {
  id: string;
  productId: string;
  channel: "facebook" | "instagram";
  accountId: string;
  status: "queued" | "processing" | "published" | "failed" | "action_required";
  postId: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type ProductPublicationSnapshot = {
  requestKey: string;
  jobs: ProductPublicationJob[];
  summary: {
    total: number;
    successful: number;
    failed: number;
    inProgress: number;
    needsAction: number;
  };
};

export async function getProductCatalog(
  includeArchived = false,
): Promise<CatalogProduct[]> {
  const response = await fetchApiResponse(
    `/api/social/products${includeArchived ? "?includeArchived=true" : ""}`,
  );
  const result = await readJsonResponse<{ products: CatalogProduct[] }>(response);
  return result.products;
}

export async function getInventoryMovements(
  productId: string,
): Promise<InventoryMovement[]> {
  const response = await fetchApiResponse(
    `/api/social/products/${encodeURIComponent(productId)}/inventory-movements`,
  );
  const result = await readJsonResponse<{ movements: InventoryMovement[] }>(
    response,
  );
  return result.movements;
}

export async function getPublishableAccounts(): Promise<PublishableAccount[]> {
  const response = await fetchApiResponse("/api/social/connections");
  const result = await readJsonResponse<{
    facebook: Omit<PublishableAccount, "channel"> | null;
    instagram: Omit<PublishableAccount, "channel"> | null;
  }>(response);
  return [
    result.facebook ? { ...result.facebook, channel: "facebook" } : null,
    result.instagram ? { ...result.instagram, channel: "instagram" } : null,
  ].filter((account): account is PublishableAccount => account !== null);
}

export async function publishCatalogProducts(input: {
  requestKey: string;
  productIds: string[];
  targets: Array<{
    channel: PublishableAccount["channel"];
    accountId: string;
  }>;
}): Promise<ProductPublicationSnapshot> {
  const response = await fetchApiResponse("/api/social/products/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJsonResponse(response);
}

export async function getProductPublicationJobs(
  requestKey: string,
): Promise<ProductPublicationSnapshot> {
  const response = await fetchApiResponse(
    `/api/social/products/publish-jobs?requestKey=${encodeURIComponent(requestKey)}`,
  );
  return readJsonResponse(response);
}

export async function retryProductPublicationJobs(
  jobIds: string[],
): Promise<ProductPublicationSnapshot> {
  const response = await fetchApiResponse(
    "/api/social/products/publish-jobs/retry",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds }),
    },
  );
  return readJsonResponse(response);
}

export async function getProductCandidates(): Promise<ProductCandidate[]> {
  const response = await fetchApiResponse(
    "/api/social/products/post-candidates",
  );
  const result = await readJsonResponse<{ candidates: ProductCandidate[] }>(
    response,
  );
  return result.candidates;
}

export type ProductExtractionQueueCounts = {
  pending: number;
  processing: number;
  waitingMedia: number;
  waitingAssociation: number;
  failed: number;
  /** Held back by an exhausted AI quota; resumes on its own. */
  quotaPaused: number;
};

export const emptyProductExtractionQueueCounts: ProductExtractionQueueCounts = {
  pending: 0,
  processing: 0,
  waitingMedia: 0,
  waitingAssociation: 0,
  failed: 0,
  quotaPaused: 0,
};

/**
 * Totals over the workspace's whole review queue, ignoring the page filters, so
 * the badge keeps its meaning while the merchant moves between filters.
 */
export type ProductExtractionSuggestionCounts = {
  total: number;
  product: number;
  /** Messages that turned out to be a post candidate, a greeting or an order. */
  notProduct: number;
  pendingReview: number;
  /** Awaiting a decision *and* holding a product — the badge number. */
  pendingProductReview: number;
  draftCreated: number;
  possibleDuplicate: number;
};

export const emptyProductExtractionSuggestionCounts: ProductExtractionSuggestionCounts =
  {
    total: 0,
    product: 0,
    notProduct: 0,
    pendingReview: 0,
    pendingProductReview: 0,
    draftCreated: 0,
    possibleDuplicate: 0,
  };

export type ProductExtractionPagination = {
  total: number;
  limit: number;
  offset: number;
  /** `null` when this page already held the last row. */
  nextOffset: number | null;
};

/** How big a page of the review queue is. The server clamps to the same bound. */
export const PRODUCT_EXTRACTION_PAGE_SIZE = 50;

export const emptyProductExtractionPagination: ProductExtractionPagination = {
  total: 0,
  limit: PRODUCT_EXTRACTION_PAGE_SIZE,
  offset: 0,
  nextOffset: null,
};

export type ProductExtractionListStatus =
  | "review"
  | "draft_created"
  | "possible_duplicate";

export type WhatsAppProductExtractionsQuery = {
  classification?: "product" | "not_product";
  statuses?: ProductExtractionListStatus[];
  limit?: number;
  offset?: number;
};

export type WhatsAppProductExtractions = {
  suggestions: ProductExtractionSuggestion[];
  /** Jobs stuck on something the merchant or a download has to resolve. */
  pendingJobs: ProductExtractionQueueCounts;
  suggestionCounts: ProductExtractionSuggestionCounts;
  pagination: ProductExtractionPagination;
};

/**
 * One page of the WhatsApp product review queue.
 *
 * Filtered and paged server-side: the queue holds one row per imported message,
 * most of them `not_product`, so a client-side page of the fifty newest rows
 * buried the handful of suggestions that actually held a product — and could
 * never reach the rest.
 */
export async function getWhatsAppProductExtractions(
  query: WhatsAppProductExtractionsQuery = {},
): Promise<WhatsAppProductExtractions> {
  const params = new URLSearchParams();
  if (query.classification) params.set("classification", query.classification);
  for (const status of query.statuses ?? []) params.append("status", status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  const search = params.toString();
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions${search ? `?${search}` : ""}`,
  );
  const result = await readJsonResponse<{
    suggestions: ProductExtractionSuggestion[];
    pendingJobs?: Partial<ProductExtractionQueueCounts>;
    suggestionCounts?: Partial<ProductExtractionSuggestionCounts>;
    pagination?: Partial<ProductExtractionPagination>;
  }>(response);
  return {
    suggestions: result.suggestions ?? [],
    pendingJobs: {
      ...emptyProductExtractionQueueCounts,
      ...(result.pendingJobs ?? {}),
    },
    suggestionCounts: {
      ...emptyProductExtractionSuggestionCounts,
      ...(result.suggestionCounts ?? {}),
    },
    pagination: {
      ...emptyProductExtractionPagination,
      ...(result.pagination ?? {}),
    },
  };
}

/** Defined with its merchant copy so the two cannot drift apart. */
export type { ExtractionQuotaEstimate } from "./extraction-quota-copy";
import type { ExtractionQuotaEstimate } from "./extraction-quota-copy";

export async function analyzeWhatsAppProductMessages(
  messageId?: string,
): Promise<{
  queuedMessages: number;
  quota?: ExtractionQuotaEstimate;
}> {
  const response = await fetchApiResponse(
    "/api/social/products/extract-whatsapp",
    messageId
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId }),
        }
      : { method: "POST" },
  );
  return readJsonResponse(response);
}

export async function createExtractionProductDraft(
  suggestionId: string,
  product?: ProductInput,
): Promise<CatalogProduct> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/create-draft`,
    {
      method: "POST",
      ...(product
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product }),
          }
        : {}),
    },
  );
  const result = await readJsonResponse<{ product: CatalogProduct }>(response);
  return result.product;
}

export async function dismissProductExtraction(
  suggestionId: string,
): Promise<void> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/dismiss`,
    { method: "POST" },
  );
  await readJsonResponse<{ dismissed: boolean }>(response);
}

export async function reviewProductExtraction(input: {
  suggestionId: string;
  field: string;
  correct: boolean;
}): Promise<void> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(input.suggestionId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field: input.field, correct: input.correct }),
    },
  );
  await readJsonResponse<{ reviewed: boolean }>(response);
}

export async function createCatalogProduct(
  product: ProductInput,
  importedMetaPost?: ImportedMetaPost,
): Promise<CatalogProduct> {
  const response = await fetchApiResponse("/api/social/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...product,
      ...(importedMetaPost && { importedMetaPost }),
    }),
  });
  const result = await readJsonResponse<{ product: CatalogProduct }>(response);
  return result.product;
}

export async function updateCatalogProduct(input: {
  id: string;
  product: ProductInput;
}): Promise<CatalogProduct> {
  const response = await fetchApiResponse(
    `/api/social/products/${encodeURIComponent(input.id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.product),
    },
  );
  const result = await readJsonResponse<{ product: CatalogProduct }>(response);
  return result.product;
}

export async function importProductCandidate(
  postId: string,
): Promise<CatalogProduct> {
  const response = await fetchApiResponse(
    `/api/social/products/import-post/${encodeURIComponent(postId)}`,
    { method: "POST" },
  );
  const result = await readJsonResponse<{ product: CatalogProduct }>(response);
  return result.product;
}

export async function extractScannedPostProduct(
  input: {
    text: string;
    platform: "facebook" | "instagram";
    postId: string;
  },
): Promise<ScannedPostProductExtraction> {
  const response = await fetchApiResponse(
    "/api/social/products/extract-scanned-post",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return readJsonResponse(response);
}

export async function uploadProductMedia(asset: {
  uri: string;
  mimeType: string;
}): Promise<{
  id: string;
  mediaType: string;
  mediaPreview: CatalogProduct["mediaPreviews"][number] | null;
}> {
  const fileResponse = await fetch(asset.uri);
  if (!fileResponse.ok) throw new Error("تعذّر قراءة ملف الوسائط المحدد.");
  const file = await fileResponse.blob();
  const response = await fetchApiResponse("/api/social/products/media", {
    method: "POST",
    headers: { "Content-Type": asset.mimeType },
    body: file,
  });
  const result = await readJsonResponse<{
    media: {
      id: string;
      mediaType: string;
      mediaPreview: CatalogProduct["mediaPreviews"][number] | null;
    };
  }>(response);
  return result.media;
}
