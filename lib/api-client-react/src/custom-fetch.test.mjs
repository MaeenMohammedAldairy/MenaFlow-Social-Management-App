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

test("optional timeout aborts a stalled request and reports a timeout", async () => {
  const { customFetch } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    await assert.rejects(customFetch("https://api.example.test", { timeoutMs: 10 }), { name: "TimeoutError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("caller cancellation remains distinct from a timeout", async () => {
  const { customFetch } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  });
  const controller = new AbortController();
  try {
    const request = customFetch("https://api.example.test", { timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deadline also covers a stalled authentication token getter", async () => {
  const { customFetch } = await import("./custom-fetch.ts");
  try {
    setAuthTokenGetter(() => new Promise(() => {}));
    await assert.rejects(customFetch("https://api.example.test", { timeoutMs: 10 }), { name: "TimeoutError" });
  } finally {
    setAuthTokenGetter(null);
  }
});


test("cancellation interrupts a stalled token getter without sending a request later", async () => {
  const { customFetch } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  let resolveToken;
  let sent = false;
  globalThis.fetch = async () => { sent = true; return new Response(null, { status: 204 }); };
  const controller = new AbortController();
  try {
    setAuthTokenGetter(() => new Promise((resolve) => { resolveToken = resolve; }));
    const request = customFetch("https://api.example.test", { timeoutMs: 1000, signal: controller.signal });
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
    resolveToken("token");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sent, false);
  } finally {
    setAuthTokenGetter(null);
    globalThis.fetch = originalFetch;
  }
});

test("server error responses preserve status and actionable error data", async () => {
  const { customFetch, ApiError } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "البلد غير صالح" }), {
    status: 422,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(customFetch("https://api.example.test", { timeoutMs: 100 }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.deepEqual(error.data, { error: "البلد غير صالح" });
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("offline network failures are not mislabeled as timeouts", async () => {
  const { customFetch } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("Network request failed"); };
  try {
    await assert.rejects(customFetch("https://api.example.test", { timeoutMs: 100 }), {
      name: "TypeError", message: "Network request failed",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
