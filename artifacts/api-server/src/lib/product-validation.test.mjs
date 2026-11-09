import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProductInput,
  publishedPostProductDraft,
} from "./product-validation.ts";
import {
  productMediaIdFromUrl,
  productMediaInfo,
  productMediaStoragePath,
  workspaceMediaKey,
} from "./product-utils.ts";

const validProduct = {
  name: "مشط حراري",
  sku: "HC-01",
  aliases: ["مشط للشعر", "مشط حراري"],
  description: "مشط حراري قابل للشحن.",
  price: "150",
  currency: "sar",
  availability: "in_stock",
  status: "active",
  mediaUrls: ["https://cdn.example.com/product.jpg"],
};

test("product media IDs resolve only inside their encoded workspace", () => {
  const fileId = "12345678-1234-1234-1234-123456789abc";
  const mediaId = `product-media-image-${workspaceMediaKey("workspace-a")}-${fileId}-jpg`;

  assert.deepEqual(productMediaInfo(mediaId, "workspace-a"), {
    mediaType: "image",
    workspaceKey: workspaceMediaKey("workspace-a"),
    fileId,
    extension: "jpg",
    mimeType: "image/jpeg",
    fileName: `${fileId}.jpg`,
    storagePath: `product-media/${workspaceMediaKey("workspace-a")}/${fileId}.jpg`,
  });
  assert.equal(productMediaInfo(mediaId, "workspace-b"), null);
  assert.equal(productMediaStoragePath("product-media-invalid"), null);
  assert.equal(
    productMediaIdFromUrl(
      `https://api.example.test/api/social/products/public-media/${encodeURIComponent(mediaId)}?expires=123&signature=abc`,
    ),
    mediaId,
  );
  assert.equal(
    productMediaIdFromUrl(
      "https://api.example.test/api/social/whatsapp/media/file-id",
    ),
    null,
  );
});

test("normalizes product fields and removes duplicate aliases", () => {
  assert.deepEqual(parseProductInput(validProduct), {
    ...validProduct,
    aliases: ["مشط للشعر", "مشط حراري"],
    currency: "SAR",
    price: "150",
  });
});

test("permits unverified draft products without price or currency", () => {
  assert.equal(
    parseProductInput({
      ...validProduct,
      price: null,
      currency: null,
      availability: "unknown",
      status: "draft",
    })?.status,
    "draft",
  );
});

test("imports published post text only as high-confidence extracted product fields", () => {
  assert.deepEqual(
    publishedPostProductDraft(
      {
        title: "محتوى يحتاج إلى مراجعة",
        body: "خلاط منزلي — السعر 20 ريال، متوفر الآن",
        mediaUrls: ["https://cdn.example.com/blender.jpg"],
      },
      {
        complete: true,
        data: {
          name: "خلاط منزلي",
          sku: null,
          aliases: [],
          description: "خلاط منزلي",
          price: "20",
          currency: "YER",
          availability: "in_stock",
        },
      },
    ),
    {
      sku: null,
      name: "خلاط منزلي",
      aliases: [],
      description: "خلاط منزلي",
      price: "20",
      currency: "YER",
      availability: "in_stock",
      status: "active",
      mediaUrls: ["https://cdn.example.com/blender.jpg"],
    },
  );
});

test("keeps incomplete post extraction in a draft with all extracted fields", () => {
  assert.deepEqual(
    publishedPostProductDraft(
      {
        title: "خلاط منزلي",
        body: "خلاط منزلي سعة 2 لتر ويعرف بالخلاط",
        mediaUrls: [],
      },
      {
        complete: false,
        data: {
          name: "خلاط منزلي",
          sku: null,
          aliases: ["الخلاط"],
          description: "خلاط منزلي سعة 2 لتر",
          price: null,
          currency: null,
          availability: null,
        },
      },
    ),
    {
      sku: null,
      name: "خلاط منزلي",
      aliases: ["الخلاط"],
      description: "خلاط منزلي سعة 2 لتر",
      price: null,
      currency: null,
      availability: "unknown",
      status: "draft",
      mediaUrls: [],
    },
  );
});

test("does not import a post without text or title", () => {
  assert.equal(
    publishedPostProductDraft({
      title: " ",
      body: "\n",
      mediaUrls: ["https://cdn.example.com/blender.jpg"],
    }),
    null,
  );
});

test("rejects prices without currency and unsupported availability values", () => {
  assert.equal(parseProductInput({ ...validProduct, currency: null }), null);
  assert.equal(
    parseProductInput({ ...validProduct, availability: "probably_in_stock" }),
    null,
  );
});

test("rejects out-of-range values and malformed requests", () => {
  assert.equal(parseProductInput(null), null);
  assert.equal(parseProductInput({ ...validProduct, name: " " }), null);
  assert.equal(parseProductInput({ ...validProduct, price: "-1" }), null);
  assert.equal(parseProductInput({ ...validProduct, price: {} }), null);
  assert.equal(
    parseProductInput({ ...validProduct, aliases: Array(21).fill("a") }),
    null,
  );
});

test("validates optional stock tracking and normalizes its audit reason", () => {
  const parsed = parseProductInput({
    name: " منتج ",
    availability: "unknown",
    status: "active",
    inventoryTracked: true,
    stockOnHand: 12,
    lowStockThreshold: 3,
    inventoryReason: "  توريد جديد  ",
  });
  assert.equal(parsed?.name, "منتج");
  assert.equal(parsed?.inventoryTracked, true);
  assert.equal(parsed?.stockOnHand, 12);
  assert.equal(parsed?.lowStockThreshold, 3);
  assert.equal(parsed?.inventoryReason, "توريد جديد");
});

test("rejects invalid stock balances and audit reasons", () => {
  const base = {
    name: "منتج",
    availability: "unknown",
    status: "active",
  };
  assert.equal(
    parseProductInput({ ...base, inventoryTracked: true, stockOnHand: -1 }),
    null,
  );
  assert.equal(
    parseProductInput({ ...base, lowStockThreshold: -1 }),
    null,
  );
  assert.equal(
    parseProductInput({
      ...base,
      inventoryReason: "x".repeat(241),
    }),
    null,
  );
});
