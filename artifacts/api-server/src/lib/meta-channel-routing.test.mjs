import assert from "node:assert/strict";
import test from "node:test";
import {
  connectedMetaChannels,
  hasDraftForMetaChannels,
  unconnectedMetaChannels,
} from "./meta-channel-routing.ts";

test("only linked Meta platforms are eligible for auto or manual publish", () => {
  const connection = { pageId: "page-1", instagramUserId: null };
  assert.deepEqual(connectedMetaChannels(["facebook", "instagram"], connection), ["facebook"]);
  assert.deepEqual(unconnectedMetaChannels(["facebook", "instagram"], connection), ["instagram"]);
});

test("no Meta connection exposes no publishable channels", () => {
  assert.deepEqual(connectedMetaChannels(["facebook", "instagram"], null), []);
  assert.deepEqual(unconnectedMetaChannels(["facebook", "instagram"], null), ["facebook", "instagram"]);
});

test("an Instagram account is available only when it is actually linked", () => {
  assert.deepEqual(
    connectedMetaChannels(["instagram"], { pageId: "page-1", instagramUserId: "ig-1" }),
    ["instagram"],
  );
});

test("auto-publish requires generated draft text for every selected channel", () => {
  assert.equal(hasDraftForMetaChannels(["facebook"], { facebook: "Facebook copy" }), true);
  assert.equal(
    hasDraftForMetaChannels(["facebook", "instagram"], {
      facebook: "Facebook copy",
      instagram: "Instagram copy",
    }),
    true,
  );
  assert.equal(
    hasDraftForMetaChannels(["facebook", "instagram"], { facebook: "Facebook copy" }),
    false,
  );
  assert.equal(hasDraftForMetaChannels(["instagram"], { instagram: "  " }), false);
  assert.equal(hasDraftForMetaChannels([], { facebook: "Facebook copy" }), false);
});
