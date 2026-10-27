import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  classifyFacebookVerification,
  decideUncertainFacebookRetry,
  parsePublishRequestBody,
} from "./publish-retry.ts";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { build } = require("esbuild");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const clientBundle = await build({
  entryPoints: [path.join(projectRoot, "lib", "api-client-react", "src", "content-management.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const clientModule = await import(
  `data:text/javascript;base64,${Buffer.from(clientBundle.outputFiles[0].text).toString("base64")}`
);
const { publishPostToChannels } = clientModule;

test("confirmed retry survives the client request and authorizes verification before publishing", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  try {
    globalThis.fetch = async (_input, init) => {
      sentBody = JSON.parse(init.body);
      return Response.json({
        success: false,
        results: {},
        post: { id: "post-test", status: "failed", error: null, channels: ["facebook"], publishResults: {} },
      });
    };

    await publishPostToChannels("post-test", ["facebook"], true);

    const request = parsePublishRequestBody(sentBody);
    assert.deepEqual(request, { channels: ["facebook"], retryUncertain: true });

    let verificationCalls = 0;
    const decision = await decideUncertainFacebookRetry(request.retryUncertain, async () => {
      verificationCalls += 1;
      return { status: "not-found" };
    });
    assert.deepEqual(decision, { action: "publish" });
    assert.equal(verificationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a retry without user confirmation remains blocked and does not query or publish", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  try {
    globalThis.fetch = async (_input, init) => {
      sentBody = JSON.parse(init.body);
      return Response.json({
        success: false,
        results: {},
        post: { id: "post-test", status: "failed", error: null, channels: ["facebook"], publishResults: {} },
      });
    };

    await publishPostToChannels("post-test", ["facebook"]);

    const request = parsePublishRequestBody(sentBody);
    assert.deepEqual(request, { channels: ["facebook"], retryUncertain: false });

    let verificationCalls = 0;
    const decision = await decideUncertainFacebookRetry(request.retryUncertain, async () => {
      verificationCalls += 1;
      return { status: "not-found" };
    });
    assert.deepEqual(decision, {
      action: "blocked",
      reason: "PREVIOUS_RESULT_UNCERTAIN",
    });
    assert.equal(verificationCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a matching Facebook page post is treated as published rather than duplicated", async () => {
  let publishCalls = 0;
  const decision = await decideUncertainFacebookRetry(true, async () => ({
    status: "found",
    result: { status: "published", postId: "page-post-123" },
  }));
  if (decision.action === "publish") publishCalls += 1;
  assert.deepEqual(decision, {
    action: "published",
    result: { status: "published", postId: "page-post-123" },
  });
  assert.equal(publishCalls, 0);
});

test("an unverifiable Facebook result stays uncertain and is not republished", async () => {
  let publishCalls = 0;
  const decision = await decideUncertainFacebookRetry(true, async () => ({
    status: "unavailable",
  }));
  if (decision.action === "publish") publishCalls += 1;
  assert.deepEqual(decision, {
    action: "uncertain",
    reason: "FACEBOOK_RESULT_CANNOT_BE_VERIFIED",
  });
  assert.equal(publishCalls, 0);
});

test("a clean search of every Facebook edge is required before declaring a post missing", () => {
  assert.deepEqual(classifyFacebookVerification({
    completedEdges: 1,
    requiredEdges: 2,
    errors: [{ code: 10 }],
  }), {
    status: "unavailable",
    reason: "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED",
  });
  assert.deepEqual(classifyFacebookVerification({
    completedEdges: 1,
    requiredEdges: 2,
    errors: [],
  }), {
    status: "unavailable",
    reason: "FACEBOOK_RESULT_CANNOT_BE_VERIFIED",
  });
  assert.deepEqual(classifyFacebookVerification({
    completedEdges: 2,
    requiredEdges: 2,
    errors: [],
  }), { status: "not-found" });
});

test("retry surfaces the missing page-reading permission and keeps publishing blocked", async () => {
  const decision = await decideUncertainFacebookRetry(true, async () => ({
    status: "unavailable",
    reason: "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED",
  }));
  assert.deepEqual(decision, {
    action: "uncertain",
    reason: "FACEBOOK_PAGES_READ_ENGAGEMENT_REQUIRED",
  });
});

test("malformed retry confirmation is rejected instead of silently treated as true", () => {
  assert.equal(parsePublishRequestBody({ channels: ["facebook"], retryUncertain: "true" }), null);
  assert.equal(parsePublishRequestBody(null), null);
});
