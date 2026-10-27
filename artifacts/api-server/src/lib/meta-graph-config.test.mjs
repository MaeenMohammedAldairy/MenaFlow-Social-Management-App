import assert from "node:assert/strict";
import test from "node:test";
import { getMetaGraphVersion } from "./meta-graph-config.ts";

const keys = [
  "META_GRAPH_VERSION",
  "VITE_META_GRAPH_VERSION",
  "FACEBOOK_GRAPH_VERSION",
];

function withGraphVersionEnvironment(values, run) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }

  try {
    run();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("prefers the canonical Meta Graph API version and keeps legacy aliases", () => {
  withGraphVersionEnvironment(
    {
      META_GRAPH_VERSION: " v27.0 ",
      VITE_META_GRAPH_VERSION: "v26.0",
      FACEBOOK_GRAPH_VERSION: "v25.0",
    },
    () => assert.equal(getMetaGraphVersion(), "v27.0"),
  );

  withGraphVersionEnvironment(
    { VITE_META_GRAPH_VERSION: " v26.0 ", FACEBOOK_GRAPH_VERSION: "v25.0" },
    () => assert.equal(getMetaGraphVersion(), "v26.0"),
  );

  withGraphVersionEnvironment(
    { FACEBOOK_GRAPH_VERSION: " v25.0 " },
    () => assert.equal(getMetaGraphVersion(), "v25.0"),
  );
});

test("uses the stable default when no version is configured", () => {
  withGraphVersionEnvironment({}, () => assert.equal(getMetaGraphVersion(), "v26.0"));
});
