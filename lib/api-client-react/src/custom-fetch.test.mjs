import assert from "node:assert/strict";
import test from "node:test";
import { fetchApiResponse, setAuthTokenGetter, setBaseUrl } from "./custom-fetch.ts";

test("attaches the current Clerk session token to API requests", async () => {
  const originalFetch = globalThis.fetch;
  const authorizationHeaders = [];
  globalThis.fetch = async (_input, init) => {
    authorizationHeaders.push(new Headers(init?.headers).get("authorization"));
    return new Response(null, { status: 204 });
  };

  try {
    setBaseUrl(null);
    setAuthTokenGetter(() => "test-session-token");
    await fetchApiResponse("https://api.example.test/api/posts");
    await fetchApiResponse("https://api.example.test/api/social/connections");
    assert.deepEqual(authorizationHeaders, [
      "Bearer test-session-token",
      "Bearer test-session-token",
    ]);
  } finally {
    setAuthTokenGetter(null);
    globalThis.fetch = originalFetch;
  }
});

test("does not replace an explicitly supplied authorization header", async () => {
  const originalFetch = globalThis.fetch;
  let authorizationHeader = null;
  globalThis.fetch = async (_input, init) => {
    authorizationHeader = new Headers(init?.headers).get("authorization");
    return new Response(null, { status: 204 });
  };

  try {
    setAuthTokenGetter(() => "test-session-token");
    await fetchApiResponse("https://api.example.test/api/posts", {
      headers: { authorization: "Bearer caller-supplied-token" },
    });
    assert.equal(authorizationHeader, "Bearer caller-supplied-token");
  } finally {
    setAuthTokenGetter(null);
    globalThis.fetch = originalFetch;
  }
});
