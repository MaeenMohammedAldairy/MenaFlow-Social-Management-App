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

test("a request with no explicit timeout is armed with the default deadline", async () => {
  const { fetchApiResponse } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  let seenSignal;
  globalThis.fetch = async (_input, init) => {
    seenSignal = init?.signal;
    return new Response(null, { status: 204 });
  };
  try {
    await fetchApiResponse("https://api.example.test/api/social/orders/summary");
    // Before this, an unstalled-but-hung server left the caller waiting forever:
    // no controller was created unless the caller asked for a timeout, so the
    // screen stayed on its loading state with no error and no retry affordance.
    assert.ok(seenSignal instanceof AbortSignal, "no abort signal reached fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the deadline rule depends on the payload shape, not the caller remembering", async () => {
  const {
    resolveRequestTimeoutMs,
    isLongUploadBody,
    DEFAULT_READ_TIMEOUT_MS,
    DEFAULT_UPLOAD_TIMEOUT_MS,
  } = await import("./custom-fetch.ts");

  assert.equal(resolveRequestTimeoutMs({}), DEFAULT_READ_TIMEOUT_MS);
  assert.equal(resolveRequestTimeoutMs({ body: '{"title":"x"}' }), DEFAULT_READ_TIMEOUT_MS);
  assert.equal(
    resolveRequestTimeoutMs({ body: new Blob(["bytes"]) }),
    DEFAULT_UPLOAD_TIMEOUT_MS,
  );
  assert.equal(
    resolveRequestTimeoutMs({ body: new Uint8Array(4) }),
    DEFAULT_UPLOAD_TIMEOUT_MS,
  );
  assert.equal(resolveRequestTimeoutMs({ timeoutMs: null }), null);
  assert.equal(resolveRequestTimeoutMs({ timeoutMs: 15, body: new Blob(["b"]) }), 15);
  assert.throws(() => resolveRequestTimeoutMs({ timeoutMs: 0 }), TypeError);
  assert.throws(() => resolveRequestTimeoutMs({ timeoutMs: Number.NaN }), TypeError);

  assert.equal(isLongUploadBody(undefined), false);
  assert.equal(isLongUploadBody("json"), false);
  assert.equal(isLongUploadBody(new Blob(["x"])), true);
});

test("timeoutMs null leaves a long-lived stream open and passes the caller's own signal", async () => {
  const { fetchApiResponse } = await import("./custom-fetch.ts");
  const originalFetch = globalThis.fetch;
  let seenSignal;
  globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      seenSignal = init?.signal;
      init?.signal?.addEventListener(
        "abort",
        () => {
          // What a real fetch does when its signal aborts mid-flight.
          const error = new Error("This operation was aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });
  const controller = new AbortController();
  try {
    const request = fetchApiResponse("https://api.example.test/api/posts/events", {
      timeoutMs: null,
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // With a deadline the fetch would receive a wrapper controller's signal; a
    // stream must get the caller's own so its lifetime is the caller's decision.
    assert.equal(seenSignal, controller.signal, "a stream got a wrapper signal it did not ask for");
    controller.abort();
    await assert.rejects(request, { name: "AbortError" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a refused request reads as an ApiError carrying the server's own words", async () => {
  const { readJsonResponse, ApiError } = await import("./custom-fetch.ts");
  const response = new Response(JSON.stringify({ error: "ليس لديك صلاحية لهذا الإجراء." }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });

  await assert.rejects(readJsonResponse(response, { method: "GET" }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.name, "ApiError", "the global 401/403/5xx routing keys off this name");
    assert.equal(error.status, 403, "the do-not-retry-4xx policy keys off this status");
    // The merchant sees error.message on several screens, so it must stay the
    // Arabic sentence the server sent rather than an English status line.
    assert.equal(error.message, "ليس لديك صلاحية لهذا الإجراء.");
    return true;
  });
});

test("a refusal with no body still says what happened", async () => {
  const { readJsonResponse } = await import("./custom-fetch.ts");
  await assert.rejects(
    readJsonResponse(new Response(null, { status: 503 }), { method: "POST" }),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /^HTTP 503/);
      return true;
    },
  );
});

test("a 2xx body that is not JSON stays a contract failure, not a refusal", async () => {
  const { readJsonResponse, ApiError } = await import("./custom-fetch.ts");
  const error = await readJsonResponse(new Response("<html>gateway</html>", { status: 200 }))
    .then(() => null, (thrown) => thrown);
  assert.ok(error instanceof Error);
  assert.ok(!(error instanceof ApiError));
  assert.equal(error.message, "تعذر قراءة استجابة الخادم.");
});
