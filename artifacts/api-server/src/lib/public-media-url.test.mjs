import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicMediaUrlError,
  resolvePublicMediaBaseUrl,
  signedProductMediaUrl,
  signedWhatsAppMediaUrl,
  verifySignedMediaRequest,
} from "./public-media-url.ts";

test("uses the configured public media origin before the app domain", () => {
  assert.equal(resolvePublicMediaBaseUrl({
    configuredBase: "https://media.example.com/api",
    expoPublicDomain: "app.example.com",
  }), "https://media.example.com");
});

test("uses a loopback request origin for local media previews even with a stale public URL", () => {
  assert.equal(resolvePublicMediaBaseUrl({
    configuredBase: "https://expired-tunnel.example.com",
    requestOrigin: "http://localhost:5000",
  }), "http://localhost:5000");
  assert.equal(resolvePublicMediaBaseUrl({
    configuredBase: "https://expired-tunnel.example.com",
    requestOrigin: "http://127.0.0.1:8081",
  }), "http://127.0.0.1:8081");
});

test("ignores non-loopback or malformed request origins", () => {
  assert.equal(resolvePublicMediaBaseUrl({
    configuredBase: "https://media.example.com",
    requestOrigin: "https://attacker.example",
  }), "https://media.example.com");
  assert.equal(resolvePublicMediaBaseUrl({
    configuredBase: "https://media.example.com",
    requestOrigin: "not a URL",
  }), "https://media.example.com");
});

test("uses the public Expo application domain as a fallback", () => {
  assert.equal(resolvePublicMediaBaseUrl({
    expoPublicDomain: "app.example.com",
  }), "https://app.example.com");
});

test("returns no origin when no publicly reachable host is configured", () => {
  assert.equal(resolvePublicMediaBaseUrl({}), null);
  assert.equal(resolvePublicMediaBaseUrl({ configuredBase: "  " }), null);
  assert.equal(resolvePublicMediaBaseUrl({ expoPublicDomain: "localhost:5000" }), null);
});

test("does not use app-domain fallbacks when production disallows them", () => {
  assert.equal(resolvePublicMediaBaseUrl({
    expoPublicDomain: "app.example.com",
    allowDeploymentFallbacks: false,
  }), null);
});

test("rejects malformed configured public media origins", () => {
  assert.throws(
    () => resolvePublicMediaBaseUrl({ configuredBase: "not a valid origin" }),
    (error) => error instanceof PublicMediaUrlError &&
      error.reason === "PUBLIC_MEDIA_BASE_URL_INVALID",
  );
});

test("rejects insecure public origins and credentials embedded in the URL", () => {
  assert.throws(
    () => resolvePublicMediaBaseUrl({ configuredBase: "ftp://media.example.com" }),
    (error) => error instanceof PublicMediaUrlError &&
      error.reason === "PUBLIC_MEDIA_BASE_URL_INVALID",
  );
  assert.throws(
    () => resolvePublicMediaBaseUrl({ configuredBase: "https://user:pass@media.example.com" }),
    (error) => error instanceof PublicMediaUrlError &&
      error.reason === "PUBLIC_MEDIA_BASE_URL_INVALID",
  );
});

test("a signed media URL verifies only for its own id, variant and unexpired window", () => {
  // The public-media routes serve bytes to anyone holding the URL — Meta's
  // scraper and webviews cannot carry the merchant's session — so the HMAC is
  // the whole gate. It must cover everything that selects what is served.
  const original = {
    key: process.env.ENCRYPTION_KEY,
    base: process.env.MENA_PUBLIC_MEDIA_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
  };
  try {
    process.env.ENCRYPTION_KEY = "signed-media-url-test-key";
    process.env.MENA_PUBLIC_MEDIA_BASE_URL = "https://media.example.com";
    delete process.env.NODE_ENV;

    const url = new URL(signedWhatsAppMediaUrl("media-1"));
    const expires = url.searchParams.get("expires");
    const signature = url.searchParams.get("signature");
    assert.equal(url.pathname, "/api/social/whatsapp/public-media/media-1");
    assert.ok(expires && signature);
    assert.equal(verifySignedMediaRequest("media-1", expires, signature), true);

    // Another id under the same signature is refused.
    assert.equal(verifySignedMediaRequest("media-2", expires, signature), false);
    // A thumbnail requested with an original's signature is refused.
    assert.equal(
      verifySignedMediaRequest("media-1", expires, signature, "thumbnail"),
      false,
    );
    // A lapsed expiry is refused even with a valid signature.
    assert.equal(
      verifySignedMediaRequest(
        "media-1",
        String(Math.floor(Date.now() / 1000) - 1),
        signature,
      ),
      false,
    );
    assert.equal(verifySignedMediaRequest("media-1", "not-a-number", signature), false);

    // Each variant is signed for itself.
    const thumbnail = new URL(
      signedWhatsAppMediaUrl("media-1", false, "thumbnail"),
    );
    assert.equal(thumbnail.searchParams.get("variant"), "thumbnail");
    assert.equal(
      verifySignedMediaRequest(
        "media-1",
        thumbnail.searchParams.get("expires"),
        thumbnail.searchParams.get("signature"),
        "thumbnail",
      ),
      true,
    );

    // The product variant reuses the same signature over a different path, so
    // the same verification applies.
    const product = new URL(signedProductMediaUrl("media-1", "thumbnail"));
    assert.equal(product.pathname, "/api/social/products/public-media/media-1");
    assert.equal(
      verifySignedMediaRequest(
        "media-1",
        product.searchParams.get("expires"),
        product.searchParams.get("signature"),
        "thumbnail",
      ),
      true,
    );
  } finally {
    if (original.key === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = original.key;
    if (original.base === undefined) delete process.env.MENA_PUBLIC_MEDIA_BASE_URL;
    else process.env.MENA_PUBLIC_MEDIA_BASE_URL = original.base;
    if (original.nodeEnv !== undefined) process.env.NODE_ENV = original.nodeEnv;
  }
});
