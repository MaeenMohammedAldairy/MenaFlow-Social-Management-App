import assert from "node:assert/strict";
import test from "node:test";
import {
  PublicMediaUrlError,
  resolvePublicMediaBaseUrl,
} from "./meta-media-url.ts";

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
