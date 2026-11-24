import assert from "node:assert/strict";
import test from "node:test";

import {
  countryCurrencyCode,
  currencyCodeFromEvidence,
  isCurrencyDerivedFromCountry,
  resolveCurrencyFromEvidence,
} from "./product-currency-resolution.ts";

const resolve = (evidence, country) => resolveCurrencyFromEvidence({ evidence, country });

// ---------------------------------------------------------------------------
// The strict path is unchanged.
// ---------------------------------------------------------------------------

test("a literal three-letter code still wins", () => {
  assert.deepEqual(resolve("45 YER", null), { code: "YER", derivedFromCountry: false });
  assert.deepEqual(resolve("السعر 45 SAR فقط", "YE"), {
    code: "SAR",
    derivedFromCountry: false,
  });
});

test("an explicitly named currency still wins over the country", () => {
  // A Yemeni workspace quoting a Saudi price must not be rewritten to YER.
  assert.deepEqual(resolve("45 ريال سعودي", "YE"), {
    code: "SAR",
    derivedFromCountry: false,
  });
  assert.deepEqual(resolve("45 ريال يمني", "SA"), {
    code: "YER",
    derivedFromCountry: false,
  });
  assert.equal(currencyCodeFromEvidence("45 ريال يمني"), "YER");
});

test("diacritics and spelling variants are normalized before matching", () => {
  assert.deepEqual(resolve("٤٥ رِيال يَمَنيّ", null), {
    code: "YER",
    derivedFromCountry: false,
  });
  assert.deepEqual(resolve("45 الريال اليمني", null), {
    code: "YER",
    derivedFromCountry: false,
  });
});

test("no evidence, no currency", () => {
  for (const evidence of [null, undefined, "", "   ", "45"]) {
    assert.deepEqual(resolve(evidence, "YE"), {
      code: null,
      derivedFromCountry: false,
    });
  }
});

// ---------------------------------------------------------------------------
// The country fallback.
// ---------------------------------------------------------------------------

test("a bare rial settles to the workspace's own rial", () => {
  assert.deepEqual(resolve("45 ريال", "YE"), { code: "YER", derivedFromCountry: true });
  assert.deepEqual(resolve("45 ريال", "SA"), { code: "SAR", derivedFromCountry: true });
  assert.deepEqual(resolve("45 ريال", "QA"), { code: "QAR", derivedFromCountry: true });
  assert.deepEqual(resolve("45 ريال", "OM"), { code: "OMR", derivedFromCountry: true });
});

test("each ambiguous word settles only for countries that use it", () => {
  assert.deepEqual(resolve("45 جنيه", "EG"), { code: "EGP", derivedFromCountry: true });
  assert.deepEqual(resolve("45 دينار", "JO"), { code: "JOD", derivedFromCountry: true });
  assert.deepEqual(resolve("45 دينار", "KW"), { code: "KWD", derivedFromCountry: true });
  assert.deepEqual(resolve("45 درهم", "AE"), { code: "AED", derivedFromCountry: true });
  assert.deepEqual(resolve("45 ليرة", "LB"), { code: "LBP", derivedFromCountry: true });
  assert.deepEqual(resolve("45 دولار", "US"), { code: "USD", derivedFromCountry: true });
});

test("a word the country does not use resolves to nothing", () => {
  // Yemen's currency is not a dollar, so «دولار» there is still ambiguous —
  // between USD and nothing we keep nothing rather than invent a code.
  assert.deepEqual(resolve("45 دولار", "YE"), { code: null, derivedFromCountry: false });
  assert.deepEqual(resolve("45 جنيه", "SA"), { code: null, derivedFromCountry: false });
  assert.deepEqual(resolve("45 ريال", "EG"), { code: null, derivedFromCountry: false });
});

test("no country, no fallback", () => {
  for (const country of [null, undefined, "", "  "]) {
    assert.deepEqual(resolve("45 ريال", country), {
      code: null,
      derivedFromCountry: false,
    });
  }
});

test("an unknown or malformed country code never guesses", () => {
  assert.equal(countryCurrencyCode("ZZ"), null);
  assert.equal(countryCurrencyCode("YEM"), null);
  assert.equal(countryCurrencyCode("ye"), "YER", "case-insensitive");
  assert.equal(countryCurrencyCode(" YE "), "YER", "trimmed");
  assert.deepEqual(resolve("45 ريال", "ZZ"), { code: null, derivedFromCountry: false });
  assert.deepEqual(resolve("45 ريال", "YEM"), { code: null, derivedFromCountry: false });
});

test("a word inside a longer word does not fire", () => {
  // «ريالة» is not a currency, and «برازيل» must not be read as a rial.
  assert.deepEqual(resolve("سلعة ريالة الشكل", "YE"), {
    code: null,
    derivedFromCountry: false,
  });
});

// ---------------------------------------------------------------------------
// The review flag.
// ---------------------------------------------------------------------------

test("flags only the currencies the country settled", () => {
  assert.equal(
    isCurrencyDerivedFromCountry({ evidence: "45 ريال", code: "YER", country: "YE" }),
    true,
  );
  assert.equal(
    isCurrencyDerivedFromCountry({ evidence: "45 ريال يمني", code: "YER", country: "YE" }),
    false,
    "the message named the currency, so a human does not need to double-check it",
  );
  assert.equal(
    isCurrencyDerivedFromCountry({ evidence: "45 ريال", code: null, country: "YE" }),
    false,
  );
  assert.equal(
    isCurrencyDerivedFromCountry({ evidence: "45 ريال", code: "SAR", country: "YE" }),
    false,
    "a code the country does not produce is never attributed to it",
  );
  assert.equal(
    isCurrencyDerivedFromCountry({ evidence: null, code: "YER", country: "YE" }),
    false,
  );
});
