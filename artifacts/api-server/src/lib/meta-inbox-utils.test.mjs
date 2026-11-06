import assert from "node:assert/strict";
import test from "node:test";
import { metaWebhookCallbackUrl } from "./meta-inbox-utils.ts";

test("builds the webhook callback from the active public base URL", () => {
  assert.equal(
    metaWebhookCallbackUrl(
      "https://current-tunnel.example/path?preview=1#app",
      "https://old-tunnel.example/api/social/meta/callback",
    ),
    "https://current-tunnel.example/api/social/meta/webhook",
  );
});

test("falls back to the OAuth redirect host when no public base is configured", () => {
  assert.equal(
    metaWebhookCallbackUrl(
      undefined,
      "https://api.example.com/api/social/meta/callback?state=ignored",
    ),
    "https://api.example.com/api/social/meta/webhook",
  );
});

test("returns no callback for missing or invalid configuration", () => {
  assert.equal(metaWebhookCallbackUrl(undefined, undefined), null);
  assert.equal(metaWebhookCallbackUrl("not a URL", undefined), null);
});
