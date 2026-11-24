import assert from "node:assert/strict";
import test from "node:test";
import {
  deviceCountryFromLocale,
  parseWhatsAppPhoneNumber,
} from "./whatsapp-phone.ts";

const SA = "SA";

test("reads a Saudi number in the shapes a keyboard actually produces", () => {
  for (const value of [
    "+966561234567",
    "00966561234567",
    "966561234567",
    "0561234567",
    "+966 56 123 4567",
    "00966 56 123 4567",
  ]) {
    const parsed = parseWhatsAppPhoneNumber(value, SA);
    assert.ok(parsed, `فشل تحليل: ${value}`);
    assert.equal(parsed.country, "SA", value);
    assert.equal(parsed.nationalNumber, "561234567", value);
  }
});

test("reads Arabic-Indic and Persian digits", () => {
  // A merchant typing on an Arabic keyboard produces these; rejecting them sends
  // them back to work out which spelling the app wants.
  assert.equal(
    parseWhatsAppPhoneNumber("٠٥٦١٢٣٤٥٦٧", SA)?.nationalNumber,
    "561234567",
  );
  assert.equal(
    parseWhatsAppPhoneNumber("۰۰۹۶۶۵۶۱۲۳۴۵۶۷", SA)?.nationalNumber,
    "561234567",
  );
  assert.equal(
    parseWhatsAppPhoneNumber("+٩٦٦٥٦١٢٣٤٥٦٧", SA)?.nationalNumber,
    "561234567",
  );
});

test("a number the merchant spelled out internationally is not thrown away", () => {
  // `+` means they chose the country code themselves; only the provider can say
  // whether the number exists, so an "invalid" verdict from the library is passed
  // through rather than turned into a rejection at the keyboard.
  const parsed = parseWhatsAppPhoneNumber("+9665612", SA);
  assert.ok(parsed, "a + number must be returned even when the library calls it invalid");
  assert.equal(parsed.number, "+9665612");
});

test("digits without a leading plus are re-read as international", () => {
  const parsed = parseWhatsAppPhoneNumber("966 56 123 4567", SA);
  assert.ok(parsed);
  assert.equal(parsed.nationalNumber, "561234567");
});

test("nothing readable yields null rather than a crash", () => {
  for (const value of ["", "   ", "abc", "--", "++", "0000"]) {
    assert.doesNotThrow(() => parseWhatsAppPhoneNumber(value, SA), value);
  }
  assert.equal(parseWhatsAppPhoneNumber("", SA)?.number ?? null, null);
});

test("the default country comes from the device locale", () => {
  assert.equal(deviceCountryFromLocale("ar-SA"), "SA");
  assert.equal(deviceCountryFromLocale("en-US"), "US");
  assert.equal(deviceCountryFromLocale("ar-SA-u-nu-latn"), "SA");
  assert.equal(deviceCountryFromLocale("ar"), undefined, "no region in the locale");
  assert.equal(deviceCountryFromLocale(null), undefined);
  assert.equal(deviceCountryFromLocale(undefined), undefined);
  // An unknown region must not be handed to libphonenumber as a country code.
  assert.equal(deviceCountryFromLocale("ar-ZZ"), undefined);
});
