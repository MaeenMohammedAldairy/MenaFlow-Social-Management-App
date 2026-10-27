import assert from "node:assert/strict";
import test from "node:test";
import { resolveMetaWebReturnOrigin } from "./meta-web-origin.ts";

test("allows local app origins and configured workspace domains", () => {
  assert.equal(
    resolveMetaWebReturnOrigin("http://localhost:8081", [], undefined),
    "http://localhost:8081",
  );
  assert.equal(
    resolveMetaWebReturnOrigin(
      "https://app.example.com",
      ["app.example.com"],
      undefined,
    ),
    "https://app.example.com",
  );
});

test("allows an explicitly configured temporary web origin", () => {
  assert.equal(
    resolveMetaWebReturnOrigin(
      "https://preview.example.com",
      [],
      "https://preview.example.com",
    ),
    "https://preview.example.com",
  );
});

test("rejects unconfigured and malformed origins", () => {
  assert.throws(
    () =>
      resolveMetaWebReturnOrigin(
        "https://attacker.example",
        [],
        "https://preview.example.com",
      ),
    /META_RETURN_ORIGIN_INVALID/,
  );
  assert.throws(
    () =>
      resolveMetaWebReturnOrigin(
        "https://preview.example.com",
        [],
        "https://preview.example.com/path",
      ),
    /META_RETURN_ORIGIN_INVALID/,
  );
  assert.throws(
    () => resolveMetaWebReturnOrigin("javascript:alert(1)", [], undefined),
    /META_RETURN_ORIGIN_INVALID/,
  );
});
