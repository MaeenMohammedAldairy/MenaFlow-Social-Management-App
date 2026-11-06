import assert from "node:assert/strict";
import test from "node:test";
import { mediaPreviewUrl, mediaUrlForApp } from "./content-utils.ts";
import {
  formatArabicCurrency,
  formatArabicDate,
  formatArabicDateTime,
  formatArabicNumber,
  normalizeArabicDigits,
} from "./formatting.ts";

test("normalizes Arabic and Persian digits and the Arabic decimal separator", () => {
  assert.equal(normalizeArabicDigits("١٢۳٫٤٥"), "123.45");
});

test("formats numbers and supported product currencies in Arabic", () => {
  assert.equal(formatArabicNumber(1234), "١٬٢٣٤");
  assert.equal(formatArabicCurrency("1234.5", "YER"), "١٬٢٣٤٫٥ ريال يمني");
  assert.equal(formatArabicCurrency("1234.5", "SAR"), "١٬٢٣٤٫٥٠ ريال سعودي");
  assert.equal(formatArabicCurrency("12.5", "USD"), "١٢٫٥٠ دولار أمريكي");
});

test("formats valid dates consistently and ignores invalid values", () => {
  const date = "2026-11-03T12:30:00.000Z";
  assert.match(formatArabicDate(date), /٢٠٢٦/);
  assert.match(formatArabicDateTime(date), /٢٠٢٦/);
  assert.equal(formatArabicDate("not-a-date"), null);
  assert.equal(formatArabicDateTime(null), null);
});

test("routes signed WhatsApp previews through the configured API origin", () => {
  const previousDomain = process.env.EXPO_PUBLIC_DOMAIN;
  process.env.EXPO_PUBLIC_DOMAIN = "http://192.168.1.34:5000";
  try {
    const preview = mediaPreviewUrl(
      "https://unavailable.example/api/social/whatsapp/public-media/media-1?expires=123&signature=abc",
      "https://unavailable.example/api/social/whatsapp/public-media/media-1?expires=456&signature=def&variant=thumbnail",
      {},
    );
    const parsed = new URL(preview);
    assert.equal(parsed.origin, "http://192.168.1.34:5000");
    assert.equal(parsed.pathname, "/api/social/whatsapp/public-media/media-1");
    assert.equal(parsed.searchParams.get("expires"), "456");
    assert.equal(parsed.searchParams.get("signature"), "def");
    assert.equal(parsed.searchParams.get("variant"), "thumbnail");
    assert.equal(
      mediaUrlForApp(
        "https://unavailable.example/api/social/products/public-media/product-1?expires=789&signature=ghi",
      ),
      "http://192.168.1.34:5000/api/social/products/public-media/product-1?expires=789&signature=ghi",
    );
    assert.equal(
      mediaUrlForApp("https://cdn.example.com/product.jpg"),
      "https://cdn.example.com/product.jpg",
    );
  } finally {
    if (previousDomain === undefined) delete process.env.EXPO_PUBLIC_DOMAIN;
    else process.env.EXPO_PUBLIC_DOMAIN = previousDomain;
  }
});