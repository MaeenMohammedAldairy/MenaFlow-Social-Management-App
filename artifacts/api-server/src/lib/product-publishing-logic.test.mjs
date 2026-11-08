import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductPublicationMatrix,
  composeProductPostBody,
  isProductPublicationActionRequired,
  isVerifiedActiveProduct,
} from "./product-publishing-logic.ts";

test("only active products with a verification timestamp are publishable", () => {
  const verifiedAt = new Date("2026-11-08T10:00:00.000Z");
  assert.equal(
    isVerifiedActiveProduct({ status: "active", verifiedAt }),
    true,
  );
  assert.equal(
    isVerifiedActiveProduct({ status: "draft", verifiedAt }),
    false,
  );
  assert.equal(
    isVerifiedActiveProduct({ status: "active", verifiedAt: null }),
    false,
  );
  assert.equal(isVerifiedActiveProduct(null), false);
});

test("builds an independent post job for every product and selected account", () => {
  assert.deepEqual(
    buildProductPublicationMatrix(
      ["product-1", "product-2", "product-1"],
      [
        { channel: "facebook", accountId: "page-1" },
        { channel: "instagram", accountId: "instagram-1" },
      ],
    ),
    [
      { productId: "product-1", channel: "facebook", accountId: "page-1" },
      { productId: "product-1", channel: "instagram", accountId: "instagram-1" },
      { productId: "product-2", channel: "facebook", accountId: "page-1" },
      { productId: "product-2", channel: "instagram", accountId: "instagram-1" },
    ],
  );
});

test("composes platform copy only from saved product facts", () => {
  assert.equal(
    composeProductPostBody({
      name: "خلاط",
      description: "سرعتان",
      price: "25.00",
      currency: "SAR",
      availability: "in_stock",
    }),
    "خلاط\nسرعتان\n25.00 SAR\nمتوفر",
  );
});

test("marks known content/account blockers for user action", () => {
  assert.equal(isProductPublicationActionRequired("PRODUCT_NOT_AVAILABLE"), true);
  assert.equal(isProductPublicationActionRequired("INSTAGRAM_MEDIA_REQUIRED"), true);
  assert.equal(isProductPublicationActionRequired("FACEBOOK_NO_SUPPORTED_MEDIA"), true);
  assert.equal(isProductPublicationActionRequired("META_HTTP_429"), false);
});
