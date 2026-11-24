import assert from "node:assert/strict";
import test from "node:test";
import {
  mediaPreviewUrl,
  mediaUrlForApp,
  signedMediaResourceKey,
} from "./content-utils.ts";
import {
  arabicCountPhrase,
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
  assert.equal(formatArabicNumber(1234), "1,234");
  assert.equal(formatArabicCurrency("1234.5", "YER"), "1,234.5 ريال يمني");
  assert.equal(formatArabicCurrency("1234.5", "SAR"), "1,234.50 ريال سعودي");
  assert.equal(formatArabicCurrency("12.5", "USD"), "12.50 دولار أمريكي");
});

test("keeps Western digits so they match what users type", () => {
  assert.doesNotMatch(formatArabicNumber(1234), /[٠-٩]/);
  assert.equal(formatArabicCurrency("١٬٢٣٤٫٥", "YER"), "1,234.5 ريال يمني");
  assert.equal(formatArabicCurrency("1,234.5", "YER"), "1,234.5 ريال يمني");
  assert.doesNotMatch(formatArabicDate("2026-11-03T12:30:00.000Z"), /[٠-٩]/);
});

test("formats valid dates consistently and ignores invalid values", () => {
  const date = "2026-11-03T12:30:00.000Z";
  assert.match(formatArabicDate(date), /2026/);
  assert.match(formatArabicDateTime(date), /2026/);
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

test("identifies signed product and WhatsApp media independently of signature expiry", () => {
  assert.equal(
    signedMediaResourceKey(
      "https://api.example.com/api/social/products/public-media/product-1?expires=123&signature=abc",
    ),
    "https://api.example.com/api/social/products/public-media/product-1",
  );
  assert.equal(
    signedMediaResourceKey(
      "https://api.example.com/api/social/whatsapp/public-media/media-1?expires=456&signature=def",
    ),
    "https://api.example.com/api/social/whatsapp/public-media/media-1",
  );
  assert.equal(
    signedMediaResourceKey("https://cdn.example.com/product.jpg"),
    null,
  );
  assert.equal(
    signedMediaResourceKey(
      "https://api.example.com/api/social/products/public-media/product-1",
    ),
    null,
  );
});
const POST_FORMS = {
  one: "منشور واحد",
  two: "منشوران",
  few: "منشورات",
  many: "منشورًا",
};

test("counts an item with the noun form Arabic grammar requires", () => {
  // Every branch matters because these strings are read aloud by the header bell's
  // accessibility label, and "${count} + plural" is wrong for three of the four.
  assert.equal(arabicCountPhrase(1, POST_FORMS), "منشور واحد");
  assert.equal(arabicCountPhrase(2, POST_FORMS), "منشوران");
  assert.equal(arabicCountPhrase(3, POST_FORMS), "3 منشورات");
  assert.equal(arabicCountPhrase(10, POST_FORMS), "10 منشورات");
  assert.equal(arabicCountPhrase(11, POST_FORMS), "11 منشورًا");
  assert.equal(arabicCountPhrase(120, POST_FORMS), "120 منشورًا");
});

test("a count that is not a positive whole number cannot produce a nonsense phrase", () => {
  // The bell computes these by adding optional numbers from a query response; a
  // missing field must not read as "undefined منشورات".
  for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(arabicCountPhrase(count, POST_FORMS), "منشور واحد", String(count));
  }
  // A fractional count is read as a whole number of items.
  assert.equal(arabicCountPhrase(3.5, POST_FORMS), "3 منشورات");
  assert.equal(arabicCountPhrase(0.5, POST_FORMS), "منشور واحد");
});

test("digits in a counted phrase stay Latin, matching the rest of the app", () => {
  assert.match(arabicCountPhrase(7, POST_FORMS), /^7 /u);
});
