export type ProductAvailability =
  "unknown" | "in_stock" | "out_of_stock" | "preorder";
export type ProductStatus = "draft" | "active" | "archived";

export type ProductInput = {
  sku: string | null;
  name: string;
  aliases: string[];
  description: string;
  price: string | null;
  currency: string | null;
  availability: ProductAvailability;
  status: ProductStatus;
  mediaUrls: string[];
};

export type PublishedPostExtraction = {
  complete: boolean;
  data: {
    name: string | null;
    sku: string | null;
    aliases: string[];
    description: string | null;
    price: string | null;
    currency: string | null;
    availability: Exclude<ProductAvailability, "unknown"> | null;
  };
};

export function publishedPostProductDraft(post: {
  title: string;
  body: string;
  mediaUrls: string[];
}, extraction?: PublishedPostExtraction): ProductInput | null {
  if (!post.title.trim() && !post.body.trim()) return null;
  const data = extraction?.data;
  const hasPriceAndCurrency = Boolean(data?.price && data.currency);
  return {
    sku: data?.sku ?? null,
    name: data?.name ?? "",
    aliases: data?.aliases ?? [],
    description: data?.description ?? "",
    price: hasPriceAndCurrency ? data?.price ?? null : null,
    currency: hasPriceAndCurrency ? data?.currency ?? null : null,
    availability: data?.availability ?? "unknown",
    status: extraction?.complete ? "active" : "draft",
    mediaUrls: post.mediaUrls,
  };
}

const availabilities = new Set<ProductAvailability>([
  "unknown",
  "in_stock",
  "out_of_stock",
  "preorder",
]);
const statuses = new Set<ProductStatus>(["draft", "active", "archived"]);

export function parseProductInput(value: unknown): ProductInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (
    (input.sku !== undefined &&
      input.sku !== null &&
      typeof input.sku !== "string") ||
    (input.description !== undefined &&
      typeof input.description !== "string") ||
    (input.currency !== undefined &&
      input.currency !== null &&
      typeof input.currency !== "string") ||
    (input.price !== undefined &&
      input.price !== null &&
      input.price !== "" &&
      typeof input.price !== "string" &&
      typeof input.price !== "number")
  ) {
    return null;
  }
  const sku =
    typeof input.sku === "string" && input.sku.trim() ? input.sku.trim() : null;
  const description =
    typeof input.description === "string" ? input.description.trim() : "";
  const priceValue = input.price;
  const price =
    priceValue === null || priceValue === "" || priceValue === undefined
      ? null
      : typeof priceValue === "string" || typeof priceValue === "number"
        ? String(priceValue).trim()
        : null;
  const currencyValue = input.currency;
  const currency =
    typeof currencyValue === "string" && currencyValue.trim()
      ? currencyValue.trim().toUpperCase()
      : null;
  const availability = input.availability;
  const status = input.status;
  const aliases = Array.isArray(input.aliases) ? input.aliases : [];
  const mediaUrls = Array.isArray(input.mediaUrls) ? input.mediaUrls : [];

  if (
    !name ||
    name.length > 200 ||
    (sku !== null && sku.length > 100) ||
    description.length > 3000 ||
    (price !== null && !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(price)) ||
    (currency !== null && !/^[A-Z]{3}$/.test(currency)) ||
    (price !== null && currency === null) ||
    !availabilities.has(availability as ProductAvailability) ||
    !statuses.has(status as ProductStatus) ||
    aliases.length > 20 ||
    aliases.some(
      (alias) =>
        typeof alias !== "string" || !alias.trim() || alias.trim().length > 80,
    ) ||
    mediaUrls.length > 20 ||
    mediaUrls.some(
      (url) =>
        typeof url !== "string" || !url.trim() || url.trim().length > 2048,
    ) ||
    (input.aliases !== undefined && !Array.isArray(input.aliases)) ||
    (input.mediaUrls !== undefined && !Array.isArray(input.mediaUrls))
  ) {
    return null;
  }

  return {
    sku,
    name,
    aliases: [...new Set(aliases.map((alias) => alias.trim()))],
    description,
    price,
    currency,
    availability: availability as ProductAvailability,
    status: status as ProductStatus,
    mediaUrls: [...new Set(mediaUrls.map((url) => url.trim()))],
  };
}
