/**
 * The mobile app's product API.
 *
 * A thin adapter over the client generated from `lib/api-spec/openapi.yaml`. The
 * shapes live in the contract now; what is left here is the mapping between the
 * contract's names and the positional signatures the screens already call, plus
 * the two calls that cannot go through the generated client:
 *
 *  - `getPublishableAccounts` reads `/social/connections`, which returns
 *    facebook/instagram slots rather than a list.
 *  - nothing else. `uploadProductMedia` used to be here too: the contract
 *    declared the body as `image/*`, which a code generator pins as a literal
 *    content type and the server's `express.raw` filter rejects. The contract now
 *    declares `application/octet-stream` plus a `mediaType` query parameter, so
 *    the endpoint goes through the generated client like the rest.
 */
import {
  fetchApiResponse,
  readJsonResponse,
  createCatalogProduct as generatedCreateCatalogProduct,
  createProductExtractionDraft,
  decideProductChangeProposal as generatedDecideProductChangeProposal,
  dismissProductExtractionSuggestion,
  extractScannedPostProduct as generatedExtractScannedPostProduct,
  extractWhatsAppProductMessages,
  getProductExtractionMetrics as generatedGetProductExtractionMetrics,
  getProductPublicationJobs as generatedGetProductPublicationJobs,
  getWhatsAppProductExtractions as generatedGetWhatsAppProductExtractions,
  importPostAsProduct,
  listCatalogProducts,
  listInventoryMovements,
  listProductCandidates,
  listProductChangeProposals,
  listProductChanges,
  proposeProductUpdate as generatedProposeProductUpdate,
  publishCatalogProducts as generatedPublishCatalogProducts,
  reprocessProductExtraction as generatedReprocessProductExtraction,
  restoreProductExtractionSuggestion,
  retryProductPublicationJobs as generatedRetryProductPublicationJobs,
  reviewProductExtractionSuggestion,
  updateCatalogProduct as generatedUpdateCatalogProduct,
  uploadProductMedia as generatedUploadProductMedia,
  type CatalogProduct as GeneratedCatalogProduct,
  type GetWhatsAppProductExtractionsStatusItem,
  type ImportedMetaPost as GeneratedImportedMetaPost,
  type InventoryMovement,
  type ProductCandidate,
  type ProductChangeDecisionResponse,
  type ProductChangeDiff,
  type ProductChangeProposal,
  type ProductChangeRecord,
  type ProductExtractionListResponse,
  type ProductExtractionMetrics,
  type ProductExtractionPagination,
  type ProductExtractionQueueCounts,
  type ProductExtractionReprocessResponse,
  type ProductExtractionReviewInputField,
  type ProductExtractionSuggestion,
  type ProductExtractionSuggestionCounts,
  type ProductFieldKey,
  type ProductPublicationHistory,
  type ProductPublicationJob,
  type ProductPublicationRetryResponse,
  type ProductPublicationSnapshot,
  type ProductUpdateProposalResponse,
  type ScannedPostExtraction,
  type ScannedPostExtractionInput,
} from "@workspace/api-client-react";

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
  ProductPublicationJob,
  ProductPublicationSnapshot,
  InventoryMovement,
  ProductCandidate,
  ProductChangeDiff,
  ProductChangeRecord,
  ProductChangeProposal,
  ProductExtractionMetrics,
  ProductExtractionSuggestion,
  ProductExtractionQueueCounts,
  ProductExtractionSuggestionCounts,
  ProductExtractionPagination,
  ProductExtractionReviewInputField,
};

/** The statuses the review queue can be filtered by. `dismissed` is not one. */
export type ProductExtractionListStatus = GetWhatsAppProductExtractionsStatusItem;

/**
 * A Meta post turned into a product. The contract requires every field, but the
 * editor builds this from a screen that only knows some of them, so the mobile
 * type keeps them optional and `createCatalogProduct` fills the rest.
 */
export type ImportedMetaPost = {
  platform: "facebook" | "instagram";
  id: string;
  text: string;
  publishedAt: string | null;
  url: string | null;
  imageUrl: string | null;
  mediaType?: string | null;
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

/** The contract calls it `ScannedPostExtraction`; the screens call it this. */
export type ScannedPostProductExtraction = ScannedPostExtraction;

export async function getProductCatalog(
  includeArchived = false,
): Promise<CatalogProduct[]> {
  return (await listCatalogProducts({ includeArchived })).products;
}

export async function getInventoryMovements(
  productId: string,
): Promise<InventoryMovement[]> {
  return (await listInventoryMovements(productId)).movements;
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
  return generatedPublishCatalogProducts(input);
}

export async function getProductPublicationJobs(
  requestKey: string,
): Promise<ProductPublicationSnapshot> {
  return generatedGetProductPublicationJobs({ requestKey });
}

/**
 * Not a `ProductPublicationSnapshot`: the retry response carries no
 * `requestKey`, because the retried jobs can belong to several requests at once.
 * The previous signature claimed otherwise, so a caller reading `.requestKey` off
 * the result got `undefined` where the type promised a string.
 */
export async function retryProductPublicationJobs(
  jobIds: string[],
): Promise<ProductPublicationRetryResponse> {
  return generatedRetryProductPublicationJobs({ jobIds });
}

export async function getProductCandidates(): Promise<ProductCandidate[]> {
  return (await listProductCandidates()).candidates;
}

export const emptyProductExtractionQueueCounts: ProductExtractionQueueCounts = {
  pending: 0,
  processing: 0,
  waitingMedia: 0,
  waitingAssociation: 0,
  failed: 0,
  quotaPaused: 0,
  noText: 0,
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

/** How big a page of the review queue is. The server clamps to the same bound. */
export const PRODUCT_EXTRACTION_PAGE_SIZE = 50;

export const emptyProductExtractionPagination: ProductExtractionPagination = {
  total: 0,
  limit: PRODUCT_EXTRACTION_PAGE_SIZE,
  offset: 0,
  nextOffset: null,
};

export type WhatsAppProductExtractionsQuery = {
  classification?: "product" | "not_product";
  statuses?: ProductExtractionListStatus[];
  senderRole?: "merchant" | "customer" | "unknown";
  limit?: number;
  offset?: number;
};

export type WhatsAppProductExtractions = ProductExtractionListResponse;

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
  return generatedGetWhatsAppProductExtractions({
    classification: query.classification,
    status: query.statuses,
    senderRole: query.senderRole,
    limit: query.limit,
    offset: query.offset,
  });
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
  return extractWhatsAppProductMessages(messageId ? { messageId } : {});
}

export async function createExtractionProductDraft(
  suggestionId: string,
  product?: ProductInput,
  overrideReason?: string,
): Promise<CatalogProduct> {
  const created = await createProductExtractionDraft(suggestionId, {
    ...(product ? { product } : {}),
    ...(overrideReason ? { overrideReason } : {}),
  });
  return created.product;
}

export async function dismissProductExtraction(
  suggestionId: string,
): Promise<void> {
  await dismissProductExtractionSuggestion(suggestionId);
}

export async function reviewProductExtraction(input: {
  suggestionId: string;
  field: ProductExtractionReviewInputField;
  correct: boolean;
}): Promise<void> {
  await reviewProductExtractionSuggestion(input.suggestionId, {
    field: input.field,
    correct: input.correct,
  });
}

export async function reprocessProductExtraction(
  suggestionId: string,
): Promise<ProductExtractionReprocessResponse> {
  return generatedReprocessProductExtraction(suggestionId);
}

export async function proposeProductUpdate(
  suggestionId: string,
  productId?: string,
): Promise<ProductUpdateProposalResponse> {
  return generatedProposeProductUpdate(
    suggestionId,
    productId ? { productId } : {},
  );
}

export async function decideProductChangeProposal(
  proposalId: string,
  decision: "accepted" | "rejected",
): Promise<ProductChangeDecisionResponse> {
  return generatedDecideProductChangeProposal(proposalId, { decision });
}

export async function getProductChanges(
  productId: string,
): Promise<ProductChangeRecord[]> {
  return (await listProductChanges(productId)).changes;
}

export async function getProductExtractionMetrics(): Promise<ProductExtractionMetrics> {
  return generatedGetProductExtractionMetrics();
}

export async function restoreProductExtraction(
  suggestionId: string,
): Promise<{ restored: boolean }> {
  return restoreProductExtractionSuggestion(suggestionId);
}

export async function getProductChangeProposals(
  query: { status?: ProductChangeProposal["status"] } = {},
): Promise<{ proposals: ProductChangeProposal[] }> {
  return listProductChangeProposals(
    query.status ? { status: query.status } : undefined,
  );
}

export async function createCatalogProduct(
  product: ProductInput,
  importedMetaPost?: ImportedMetaPost,
): Promise<CatalogProduct> {
  const created = await generatedCreateCatalogProduct({
    ...product,
    ...(importedMetaPost
      ? { importedMetaPost: toGeneratedImportedMetaPost(importedMetaPost) }
      : {}),
  });
  return created.product;
}

export async function updateCatalogProduct(input: {
  id: string;
  product: ProductInput;
}): Promise<CatalogProduct> {
  return (await generatedUpdateCatalogProduct(input.id, input.product)).product;
}

export async function importProductCandidate(
  postId: string,
): Promise<CatalogProduct> {
  return (await importPostAsProduct(postId)).product;
}

export async function extractScannedPostProduct(
  input: ScannedPostExtractionInput,
): Promise<ScannedPostProductExtraction> {
  return generatedExtractScannedPostProduct(input);
}

/**
 * Where each extracted value came from, as character offsets into a source
 * message.
 *
 * The server writes these inside `extractedData.evidence_spans`, not as a
 * top-level field — the review card used to read a top-level `evidenceSpans`
 * that nothing ever sent, so the highlighting silently never fired.
 */
export function productExtractionEvidenceSpans(
  suggestion: ProductExtractionSuggestion,
): Array<{ sourceId: string; start: number; end: number }> {
  const raw = suggestion.extractedData.evidence_spans;
  if (!raw) return [];
  const spans: Array<{ sourceId: string; start: number; end: number }> = [];
  for (const value of Object.values(raw)) {
    const sourceId =
      typeof value?.sourceId === "string"
        ? value.sourceId
        : typeof value?.source_id === "string"
          ? value.source_id
          : null;
    const start = value?.start;
    const end = value?.end;
    if (
      sourceId &&
      typeof start === "number" &&
      typeof end === "number" &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      end > start
    ) {
      spans.push({ sourceId, start, end });
    }
  }
  return spans;
}

/**
 * Why the extractor scored a suggestion the way it did, in words.
 *
 * The server writes these into `extractedData.confidence_reasons`. The review
 * card used to read a top-level `confidenceReasons` that nothing ever sent, so
 * the list never rendered — the merchant saw a bare score with no explanation.
 */
export function productExtractionConfidenceReasons(
  suggestion: ProductExtractionSuggestion,
): string[] {
  return suggestion.extractedData.confidence_reasons ?? [];
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
  // The generated function sends `application/octet-stream`, which the server
  // accepts alongside the file's own content type, and names the real type in the
  // query. Pinning `image/*` instead — what the contract used to say — was
  // rejected by the server's `express.raw` filter, because a wildcard is not a
  // content type.
  return (await generatedUploadProductMedia(file, { mediaType: asset.mimeType }))
    .media;
}

function toGeneratedImportedMetaPost(
  post: ImportedMetaPost,
): GeneratedImportedMetaPost {
  return {
    platform: post.platform,
    id: post.id,
    text: post.text,
    publishedAt: post.publishedAt,
    url: post.url,
    imageUrl: post.imageUrl,
    mediaType: post.mediaType ?? null,
  };
}
