import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPO_PUSH_URL,
  MAX_MESSAGES_PER_REQUEST,
  buildPushRequestInit,
  chunkPushMessages,
  classifyPushResponse,
  sendPushBatch,
  toPushMessage,
} from "./expo-push-client.ts";

function fakeResponse({ status = 200, body = null, headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => {
      if (body === null) throw new Error("no body");
      return body;
    },
  };
}

function message(token) {
  return { to: token, title: "طلب جديد", body: "طلب من أحمد" };
}

test("chunkPushMessages splits at Expo's documented batch limit", () => {
  const messages = Array.from({ length: 250 }, (_, index) => message(`t${index}`));
  const chunks = chunkPushMessages(messages);

  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [100, 100, 50],
  );
  assert.equal(MAX_MESSAGES_PER_REQUEST, 100);
  assert.deepEqual(chunks.flat(), messages, "الترتيب محفوظ");

  assert.deepEqual(chunkPushMessages([]), []);
  assert.throws(() => chunkPushMessages(messages, 0), /positive/);
});

test("toPushMessage sets an Android channel and nothing platform-specific for iOS", () => {
  const notification = { title: "طلب جديد", body: "طلب من أحمد", data: { route: "/x" } };

  const android = toPushMessage("token-a", notification, { platform: "android" });
  const ios = toPushMessage("token-i", notification, { platform: "ios" });

  assert.equal(android.channelId, "menaflow-alerts");
  assert.equal(ios.channelId, undefined);
  assert.equal(android.to, "token-a");
  assert.deepEqual(android.data, { route: "/x" });

  // A silent alert is indistinguishable from no alert on a busy phone.
  assert.equal(android.sound, "default");
  assert.equal(android.priority, "high");
  // Stale alerts are noise: a customer message from yesterday must not arrive.
  assert.equal(android.ttl, 4 * 60 * 60);

  assert.equal(toPushMessage("t", notification, { badge: 3 }).badge, 3);
  assert.equal(toPushMessage("t", notification).badge, undefined);
});

test("the access token is sent only when one exists", () => {
  const withToken = buildPushRequestInit([message("t")], " secret-token ");
  const without = buildPushRequestInit([message("t")], "   ");

  assert.equal(withToken.headers.authorization, "Bearer secret-token");
  assert.equal(without.headers.authorization, undefined);
  assert.equal(without.headers["content-type"], "application/json");
  assert.equal(JSON.parse(without.body).length, 1);
});

test("tickets are matched to tokens by index", () => {
  const messages = [message("ok-token"), message("dead-token"), message("weird-token")];
  const result = classifyPushResponse(
    {
      data: [
        { status: "ok", id: "ticket-1" },
        {
          status: "error",
          message: "\"dead-token\" is not a registered push notification token",
          details: { error: "DeviceNotRegistered" },
        },
        { status: "error", message: "Something new", details: { error: "BrandNewCode" } },
      ],
    },
    messages,
  );

  assert.equal(result.accepted, 1);
  assert.deepEqual(result.deviceNotRegistered, ["dead-token"]);
  // An unrecognised code is treated as transient: dropping an alert silently is
  // the worse failure.
  assert.deepEqual(result.retryable, ["weird-token"]);
  assert.deepEqual(result.permanent, []);
  assert.match(result.lastErrorMessage, /DeviceNotRegistered/);
});

test("MessageTooBig is permanent, so it is not retried forever", () => {
  const result = classifyPushResponse(
    { data: [{ status: "error", message: "too big", details: { error: "MessageTooBig" } }] },
    [message("t1")],
  );

  assert.deepEqual(result.permanent, ["t1"]);
  assert.deepEqual(result.retryable, []);
  assert.equal(result.accepted, 0);
});

test("a malformed Expo response does not look like success", () => {
  const result = classifyPushResponse({ unexpected: true }, [message("t1"), message("t2")]);

  assert.equal(result.accepted, 0);
  assert.equal(result.requestError, "EXPO_RESPONSE_MISSING_DATA");
  assert.deepEqual(result.retryable, ["t1", "t2"]);
});

test("429 reports the retry window instead of guessing one", async () => {
  const calls = [];
  const result = await sendPushBatch([message("t1"), message("t2")], {
    accessToken: "tok",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fakeResponse({ status: 429, headers: { "retry-after": "37" } });
    },
  });

  assert.equal(result.requestError, "EXPO_RATE_LIMITED");
  assert.equal(result.retryAfterSeconds, 37);
  assert.deepEqual(result.retryable, ["t1", "t2"]);
  assert.equal(result.accepted, 0);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, EXPO_PUSH_URL);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  assert.equal(JSON.parse(calls[0].init.body).length, 2);
});

test("a 5xx and a dropped request both leave the batch retryable", async () => {
  const serverError = await sendPushBatch([message("t1")], {
    fetchImpl: async () =>
      fakeResponse({ status: 503, body: { errors: [{ message: "upstream down" }] } }),
  });
  assert.equal(serverError.requestError, "upstream down");
  assert.deepEqual(serverError.retryable, ["t1"]);

  const thrown = await sendPushBatch([message("t1")], {
    fetchImpl: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.match(thrown.requestError, /^EXPO_REQUEST_FAILED:TypeError/);
  assert.deepEqual(thrown.retryable, ["t1"]);
  assert.equal(thrown.accepted, 0);
});

test("an unparsable error body is still reported as a failure", async () => {
  const result = await sendPushBatch([message("t1")], {
    fetchImpl: async () => fakeResponse({ status: 500, body: null }),
  });

  assert.equal(result.requestError, "EXPO_HTTP_500");
  assert.deepEqual(result.retryable, ["t1"]);
});

test("an empty batch never reaches the network", async () => {
  let called = false;
  const result = await sendPushBatch([], {
    fetchImpl: async () => {
      called = true;
      return fakeResponse({});
    },
  });

  assert.equal(called, false);
  assert.deepEqual(result, {
    accepted: 0,
    deviceNotRegistered: [],
    retryable: [],
    permanent: [],
  });
});

test("a batch above the limit is a programming error, not a silent truncation", async () => {
  const tooMany = Array.from({ length: 101 }, (_, index) => message(`t${index}`));

  await assert.rejects(
    () => sendPushBatch(tooMany, { fetchImpl: async () => fakeResponse({}) }),
    /at most 100 messages, received 101/,
  );
});

test("a successful send reports the accepted count", async () => {
  const result = await sendPushBatch([message("t1"), message("t2")], {
    fetchImpl: async () =>
      fakeResponse({ body: { data: [{ status: "ok", id: "a" }, { status: "ok", id: "b" }] } }),
  });

  assert.equal(result.accepted, 2);
  assert.deepEqual(result.retryable, []);
  assert.equal(result.lastErrorMessage, undefined);
});
