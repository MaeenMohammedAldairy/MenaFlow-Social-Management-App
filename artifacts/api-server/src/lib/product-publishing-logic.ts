export type ProductPublishChannel = "facebook" | "instagram";

export type ProductPublicationTarget = {
  channel: ProductPublishChannel;
  accountId: string;
};

export function isVerifiedActiveProduct(product: {
  status: string;
  verifiedAt: Date | null;
} | null): boolean {
  return product?.status === "active" && product.verifiedAt !== null;
}

export function buildProductPublicationMatrix(
  productIds: readonly string[],
  targets: readonly ProductPublicationTarget[],
): Array<{
  productId: string;
  channel: ProductPublishChannel;
  accountId: string;
}> {
  const products = [...new Set(productIds)];
  const accounts = new Map(
    targets.map((target) => [
      `${target.channel}:${target.accountId}`,
      target,
    ]),
  );
  return products.flatMap((productId) =>
    [...accounts.values()].map(({ channel, accountId }) => ({
      productId,
      channel,
      accountId,
    })),
  );
}

export function composeProductPostBody(product: {
  name: string;
  description: string;
  price: string | null;
  currency: string | null;
  availability: string;
}): string {
  const lines = [
    product.name.trim(),
    product.description.trim(),
    product.price !== null
      ? [product.price, product.currency].filter(Boolean).join(" ")
      : "",
    product.availability === "unknown"
      ? ""
      : product.availability === "in_stock"
        ? "متوفر"
        : product.availability === "out_of_stock"
          ? "غير متوفر"
          : "متاح للطلب المسبق",
  ];
  return [...new Set(lines.filter(Boolean))].join("\n");
}

export function isProductPublicationActionRequired(reason: string): boolean {
  return /^(?:INSTAGRAM_(?:MEDIA_REQUIRED|CAROUSEL_REQUIRES_2_TO_10_ITEMS|MEDIA_TYPE_UNSUPPORTED|IMAGE_JPEG_REQUIRED|VIDEO_MP4_REQUIRED)|FACEBOOK_NO_SUPPORTED_MEDIA|WHATSAPP_POST_MEDIA_UNAVAILABLE|PRODUCT_(?:NOT_AVAILABLE|POST_SOURCE_UNAVAILABLE|MEDIA_UNAVAILABLE|EXTERNAL_MEDIA_NOT_SUPPORTED)|META_ACCOUNT_NOT_CONNECTED|PUBLISH_RESULT_UNCERTAIN)$/.test(
    reason,
  );
}
