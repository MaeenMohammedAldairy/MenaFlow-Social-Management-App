import assert from "node:assert/strict";
import test from "node:test";
import { resolveTrustProxy } from "./trust-proxy.ts";

test("production trusts exactly one hop by default", () => {
  // Without it req.ip is the proxy's address and every IP-keyed rate limiter
  // pools all unauthenticated traffic into a single bucket.
  assert.equal(resolveTrustProxy({ NODE_ENV: "production" }), 1);
});

test("outside production nothing is trusted by default", () => {
  // A local client must not be able to invent X-Forwarded-For and mint a fresh
  // rate-limit key per request.
  for (const NODE_ENV of ["development", "test", undefined]) {
    assert.equal(resolveTrustProxy({ NODE_ENV }), false, String(NODE_ENV));
  }
});

test("an explicit override wins over the default", () => {
  assert.equal(resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: "false" }), false);
  assert.equal(resolveTrustProxy({ NODE_ENV: "development", MENA_TRUST_PROXY: "true" }), 1);
  assert.equal(resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: "2" }), 2);
  assert.equal(resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: " 3 " }), 3);
  assert.equal(resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: "off" }), false);
  assert.equal(resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: "" }), 1);
});

test("trusting an unbounded chain is refused", () => {
  // `true` would hand the client control of its own apparent address, so the
  // bounded hop count is the only accepted form.
  for (const value of ["6", "-1", "1.5", "loopback", "yes", "abc"]) {
    assert.throws(
      () => resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: value }),
      /MENA_TRUST_PROXY/,
      value,
    );
  }
});

test("the accepted hop range is 1 to 5", () => {
  for (const hops of [1, 2, 3, 4, 5]) {
    assert.equal(
      resolveTrustProxy({ NODE_ENV: "production", MENA_TRUST_PROXY: String(hops) }),
      hops,
    );
  }
});
