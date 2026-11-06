import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductPublicationMatrix,
  composeProductPostBody,
  isProductPublicationActionRequired,
} from "./product-publishing-logic.ts";

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
  assert.equal(isProductPublicationActionRequired("INSTAGRAM_MEDIA_REQUIRED"), true);
  assert.equal(isProductPublicationActionRequired("FACEBOOK_NO_SUPPORTED_MEDIA"), true);
  assert.equal(isProductPublicationActionRequired("META_HTTP_429"), false);
});
