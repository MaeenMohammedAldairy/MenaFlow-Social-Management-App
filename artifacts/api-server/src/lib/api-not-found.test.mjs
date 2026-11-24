import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test from "node:test";
import { apiNotFoundHandler } from "./api-not-found.ts";

async function withApi(operation) {
  const app = express();
  const router = express.Router();
  router.get("/plans", (_req, res) => res.json({ plans: [] }));
  app.use("/api", router);
  // Mounted after the router and scoped to /api, exactly as in app.ts.
  app.use("/api", apiNotFoundHandler);
  app.get("/owner/console", (_req, res) => res.type("html").send("<html></html>"));

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    return await operation(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("an unknown API path answers JSON, not Express's HTML 404", async () => {
  await withApi(async (origin) => {
    const response = await fetch(`${origin}/api/social/orderz`);
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const body = await response.json();
    assert.equal(body.code, "ROUTE_NOT_FOUND");
    assert.equal(body.method, "GET");
    assert.equal(body.path, "/api/social/orderz");
    assert.equal(typeof body.error, "string");
  });
});

test("the 404 carries the same shape as every other API error", async () => {
  // The mobile client maps errors by `code`; a route typo must be
  // distinguishable from an outage or a permission failure.
  await withApi(async (origin) => {
    const body = await (await fetch(`${origin}/api/nope`)).json();
    assert.deepEqual(Object.keys(body).sort(), ["code", "error", "method", "path"]);
  });
});

test("a real route is untouched", async () => {
  await withApi(async (origin) => {
    const response = await fetch(`${origin}/api/plans`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { plans: [] });
  });
});

test("paths outside /api keep Express's own 404", async () => {
  // The owner console serves its own asset 404; the handler must not leak
  // outside the API surface.
  await withApi(async (origin) => {
    const missing = await fetch(`${origin}/not-api`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type") ?? "", /text\/html/);

    const served = await fetch(`${origin}/owner/console`);
    assert.equal(served.status, 200);
  });
});

test("every verb is answered, not just GET", async () => {
  await withApi(async (origin) => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await fetch(`${origin}/api/social/orders`, { method });
      assert.equal(response.status, 404, method);
      assert.equal((await response.json()).code, "ROUTE_NOT_FOUND", method);
    }
  });
});
