import { fetchApiResponse } from "@workspace/api-client-react";

export type CatalogProduct = {
  id: string;
  sku: string | null;
  name: string;
  aliases: string[];
  description: string;
  price: string | null;
  currency: string | null;
  availability: "unknown" | "in_stock" | "out_of_stock" | "preorder";
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

export type ProductInput = Omit<
  CatalogProduct,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "verifiedAt"
  | "postIds"
  | "mediaPreviews"
>;

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

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    throw new Error("تعذر قراءة استجابة الخادم.");
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : `HTTP ${response.status}`,
    );
  }
  return payload as T;
}

export async function getProductCatalog(
  includeArchived = false,
): Promise<CatalogProduct[]> {
  const response = await fetchApiResponse(
    `/api/social/products${includeArchived ? "?includeArchived=true" : ""}`,
  );
  const result = await responseJson<{ products: CatalogProduct[] }>(response);
  return result.products;
}

export async function getPublishableAccounts(): Promise<PublishableAccount[]> {
  const response = await fetchApiResponse("/api/social/connections");
  const result = await responseJson<{
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
  return responseJson(response);
}

export async function getProductPublicationJobs(
  requestKey: string,
): Promise<ProductPublicationSnapshot> {
  const response = await fetchApiResponse(
    `/api/social/products/publish-jobs?requestKey=${encodeURIComponent(requestKey)}`,
  );
  return responseJson(response);
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
  return responseJson(response);
}

export async function getProductCandidates(): Promise<ProductCandidate[]> {
  const response = await fetchApiResponse(
    "/api/social/products/post-candidates",
  );
  const result = await responseJson<{ candidates: ProductCandidate[] }>(
    response,
  );
  return result.candidates;
}

export async function getWhatsAppProductExtractions(): Promise<
  ProductExtractionSuggestion[]
> {
  const response = await fetchApiResponse(
    "/api/social/products/whatsapp-extractions",
  );
  const result = await responseJson<{
    suggestions: ProductExtractionSuggestion[];
  }>(response);
  return result.suggestions;
}

export async function analyzeWhatsAppProductMessages(): Promise<{
  queuedMessages: number;
}> {
  const response = await fetchApiResponse(
    "/api/social/products/extract-whatsapp",
    { method: "POST" },
  );
  return responseJson(response);
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
  const result = await responseJson<{ product: CatalogProduct }>(response);
  return result.product;
}

export async function dismissProductExtraction(
  suggestionId: string,
): Promise<void> {
  const response = await fetchApiResponse(
    `/api/social/products/whatsapp-extractions/${encodeURIComponent(suggestionId)}/dismiss`,
    { method: "POST" },
  );
  await responseJson<{ dismissed: boolean }>(response);
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
  await responseJson<{ reviewed: boolean }>(response);
}

export async function createCatalogProduct(
  product: ProductInput,
): Promise<CatalogProduct> {
  const response = await fetchApiResponse("/api/social/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
  const result = await responseJson<{ product: CatalogProduct }>(response);
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
  const result = await responseJson<{ product: CatalogProduct }>(response);
  return result.product;
}

export async function importProductCandidate(
  postId: string,
): Promise<CatalogProduct> {
  const response = await fetchApiResponse(
    `/api/social/products/import-post/${encodeURIComponent(postId)}`,
    { method: "POST" },
  );
  const result = await responseJson<{ product: CatalogProduct }>(response);
  return result.product;
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
  const result = await responseJson<{
    media: {
      id: string;
      mediaType: string;
      mediaPreview: CatalogProduct["mediaPreviews"][number] | null;
    };
  }>(response);
  return result.media;
}
