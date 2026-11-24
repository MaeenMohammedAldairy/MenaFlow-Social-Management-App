import {
  fetchApiResponse,
  readJsonResponse,
  listCatalogProducts,
  type CatalogProduct as GeneratedCatalogProduct,
} from "@workspace/api-client-react";
import type { ProductFieldKey, ProductPublicationHistory } from "@workspace/api-client-react";

export type ImportedMetaPost = {
  platform: "facebook" | "instagram";
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
  imageUrl: string | null;
  mediaType?: string | null;
};

/**
 * The wire shape, generated from `lib/api-spec/openapi.yaml`. It used to be a
 * hand-written copy that had drifted: it marked `sourceTrust`, `updatedBy` and
 * `updatedReason` optional and omitted `ownerId`, `workspaceId`,
 * `normalizedName` and `lastExtractionSuggestionId`, all of which the server
 * always sends.
 */
export type CatalogProduct = GeneratedCatalogProduct;

export type {
  ProductFieldKey,
  ProductPublicationHistory,
} from "@workspace/api-client-react";

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
  /** Where each extracted value came from, as character offsets in a source. */
  evidenceSpans?: Record<
    string,
    { sourceId: string; start: number; end: number }
  >;
  confidence: Record<string, number>;
  fieldReview: Record<string, boolean>;
  /** Field keys still empty in this suggestion. */
  missingFields?: ProductFieldKey[];
  missingFieldMessages?: string[];
  aiModel: string;
  /** Human-readable explanation of the computed confidence, not a raw score. */
  confidenceReasons?: string[];
  senderRole: "merchant" | "customer" | "unknown";
  version: number;
  matchStrategy:
    | "exact_sku"
    | "exact_name"
    | "alias_match"
    | "fuzzy_candidate"
    | "new_product"
    | null;
  matchedProductId: string | null;
  matchScore: string | null;
  status:
    | "review"
    | "draft_created"
    | "possible_duplicate"
    | "dismissed"
    | "superseded"
    | "update_proposed"
    | "accepted_update"
    | "rejected_update";
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
  // Server-assigned identity and bookkeeping. These are on the wire, so they
  // belong on CatalogProduct, but a merchant never sends them back.
  | "id"
  | "ownerId"
  | "workspaceId"
  | "normalizedName"
  | "sourceTrust"
  | "lastExtractionSuggestionId"
  | "updatedBy"
  | "updatedReason"
  // Derived per read, never stored as the merchant wrote them.
  | "missingFields"
  | "missingFieldMessages"
  | "publicationBlockers"
  | "publicationBlockerMessages"
  | "publicationBlocked"
  | "advisoryFields"
  | "publicationHistory"
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
  return (await listCatalogProducts({ includeArchived })).products;
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
  /**
   * Read and found to hold nothing extractable: a photo with no caption, a
   * sticker, a voice note. Their jobs completed, so they are neither a failure
   * nor waiting on anything — without this counter they simply disappear.
   */
  noText: number;
};

export const emptyProductExtractionQueueCounts: ProductExtractionQueueCounts = {
  pending: 0,
  processing: 0,
  waitingMedia: 0,
  waitingAssociation: 0,
  failed: 0,
  quotaPaused: 0,
  noText: 0,
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
  updateProposed: number;
  acceptedUpdate: number;
  rejectedUpdate: number;
  superseded: number;
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
    updateProposed: 0,
    acceptedUpdate: 0,
    rejectedUpdate: 0,
    superseded: 0,
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
  | "possible_duplicate"
  | "update_proposed"
  | "accepted_update"
  | "rejected_update"
  | "superseded";

export type WhatsAppProductExtractionsQuery = {
  classification?: "product" | "not_product";
  statuses?: ProductExtractionListStatus[];
  senderRole?: "merchant" | "customer" | "unknown";
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
  if (query.senderRole) params.set("senderRole", query.senderRole);
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
  overrideReason?: string,
): Promise<CatalogProduct> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/create-draft`,
    {
      method: "POST",
      ...(product
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product,
              ...(overrideReason ? { overrideReason } : {}),
            }),
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

export async function reprocessProductExtraction(
  suggestionId: string,
): Promise<{ rulesetVersion: string; queued: boolean }> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/reprocess`,
    { method: "POST" },
  );
  return readJsonResponse(response);
}

export type ProductChangeDiff = Record<
  string,
  { before: unknown; after: unknown; evidence: string | null }
>;

export async function proposeProductUpdate(
  suggestionId: string,
  productId?: string,
): Promise<{ proposalId: string; diff: ProductChangeDiff }> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/propose-update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(productId ? { productId } : {}),
    },
  );
  return readJsonResponse(response);
}

export async function decideProductChangeProposal(
  proposalId: string,
  decision: "accepted" | "rejected",
): Promise<{ status: string; changedFields: string[] }> {
  const response = await fetchApiResponse(
    `/api/social/products/change-proposals/${encodeURIComponent(proposalId)}/decide`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
  return readJsonResponse(response);
}

export type ProductChangeRecord = {
  id: string;
  field: string;
  beforeValue: unknown;
  afterValue: unknown;
  sourceType: string;
  sourceId: string | null;
  actorId: string | null;
  createdAt: string;
};

export async function getProductChanges(
  productId: string,
): Promise<ProductChangeRecord[]> {
  const response = await fetchApiResponse(
    `/api/social/products/${encodeURIComponent(productId)}/changes`,
  );
  const result = await readJsonResponse<{ changes: ProductChangeRecord[] }>(response);
  return result.changes;
}

export type ProductExtractionMetrics = {
  extractionSucceeded: number;
  extractionFailed: number;
  reprocessed: number;
  proposalsAccepted: number;
  conversionRate: number;
  suggestions?: Array<{
    status: string | null;
    classification: string | null;
    total: number;
  }>;
  daily?: Array<{ day: string; event: string; total: number }>;
};

export async function getProductExtractionMetrics(): Promise<ProductExtractionMetrics> {
  const response = await fetchApiResponse(
    "/api/social/products/extraction-metrics",
  );
  return readJsonResponse(response);
}

export async function restoreProductExtraction(
  suggestionId: string,
): Promise<{ restored: boolean }> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/restore`,
    { method: "POST" },
  );
  return readJsonResponse(response);
}

export type ProductChangeProposal = {
  id: string;
  productId: string;
  suggestionId: string;
  diff: ProductChangeDiff;
  status: "proposed" | "accepted" | "rejected" | "expired";
  createdAt: string;
  decidedAt: string | null;
  product: {
    id: string;
    name: string;
    sku: string | null;
    status: string;
  } | null;
  evidence: Record<string, string | null>;
  senderRole: "merchant" | "customer" | "unknown";
};

export async function getProductChangeProposals(query: {
  status?: ProductChangeProposal["status"];
} = {}): Promise<{ proposals: ProductChangeProposal[] }> {
  const search = query.status ? `?status=${query.status}` : "";
  const response = await fetchApiResponse(
    `/api/social/products/change-proposals${search}`,
  );
  return readJsonResponse(response);
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
