import assert from "node:assert/strict";
import { test } from "node:test";

import { parseProductRows } from "./csv-product-import-parser.ts";

test("parses quoted CSV fields and maps products to drafts", () => {
  const [row] = parseProductRows(
    'name,description,price,currency,availability,aliases\r\n"عباية, سوداء","قماش ""قطني""",12.50,sar,in_stock,"عباية|رداء"',
  );

  assert.equal(row.error, undefined);
  assert.deepEqual(row.product, {
    sku: null,
    name: "عباية, سوداء",
    aliases: ["عباية", "رداء"],
    description: 'قماش "قطني"',
    price: "12.50",
    currency: "SAR",
    availability: "in_stock",
    status: "draft",
    mediaUrls: [],
  });
});

test("accepts Arabic headers and semicolon-delimited files", () => {
  const [row] = parseProductRows("اسم المنتج;رمز المنتج;التوفر\nحقيبة;B-1;متوفر");

  assert.equal(row.error, undefined);
  assert.equal(row.product.name, "حقيبة");
  assert.equal(row.product.sku, "B-1");
  assert.equal(row.product.availability, "in_stock");
});

test("reports missing names and duplicate SKUs per row", () => {
  const rows = parseProductRows("sku,name\nA-1,منتج أول\nA-1,منتج ثان\nA-2,");

  assert.equal(rows[0].error, undefined);
  assert.match(rows[1].error, /مكرر/);
  assert.match(rows[2].error, /مطلوب/);
});

test("rejects malformed quoting and missing name headers", () => {
  assert.throws(() => parseProductRows('name\n"منتج'), /غير مكتمل/);
  assert.throws(() => parseProductRows("sku,price\nA-1,10"), /عمود name/);
});
