import assert from "node:assert/strict";
import test from "node:test";
import {
  parseProductInput,
  publishedPostProductDraft,
} from "./product-validation.ts";

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
    publishedPostProductDraft({
      title: "محتوى يحتاج إلى مراجعة",
      body: "خلاط منزلي — السعر 20 ريال، متوفر الآن",
      mediaUrls: ["https://cdn.example.com/blender.jpg"],
    }, {
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
    }),
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
    publishedPostProductDraft({
      title: "خلاط منزلي",
      body: "خلاط منزلي سعة 2 لتر ويعرف بالخلاط",
      mediaUrls: [],
    }, {
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
    }),
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
