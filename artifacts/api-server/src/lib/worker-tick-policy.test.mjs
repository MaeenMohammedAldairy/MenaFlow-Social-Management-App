// ---------------------------------------------------------------------------
// Who may ask the server to run one pass over the queues.
//
// The tick exists because nothing else drives the queues in production:
// `vercel.json` has no `crons`, and every worker loop is a `setInterval` inside
// the API process, which the platform freezes between requests. So the endpoint
// has to be callable by a scheduler that has no session — and an unauthenticated
// "do work now" button on a queue that spends money on AI calls is a denial of
// service with a merchant bill attached.
//
// Hence the three rules pinned here, in this order:
//
//   1. **No secret configured, no tick.** Answering 503 rather than "open" is the
//      difference between a misconfigured deploy and an exposed one, and a
//      deployment that has not decided yet must not be the exposed one.
//   2. **A secret is a *list*, so it can be rotated** without a window where the
//      scheduler's old value fails — the same shape as `MENA_OWNER_CONSOLE_TOKEN`.
//   3. **Too-short values are not secrets.** Four characters is a typo, not a
//      bearer token, and treating it as one makes a weak deploy look configured.
//
// Pure by design: `app-workers.ts` and the queue modules cannot be imported into
// a unit test, so the decision that keeps the endpoint safe has to be the part
// that can be.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";

const {
  decideWorkerTickAccess,
  workerTickSecrets,
  workerTickBudgetMs,
} = await import("./worker-tick-policy.ts");

const SECRET = "a-very-long-worker-tick-secret-1";
const ROTATED = "another-very-long-worker-tick-secret-2";

test("no configured secret closes the tick, whatever the caller sends", () => {
  for (const authorization of [undefined, "", `Bearer ${SECRET}`]) {
    const decision = decideWorkerTickAccess({
      authorization,
      env: {},
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "TICK_DISABLED");
    // 503, not 401: the server is not refusing this caller, it is not able to
    // serve the route at all, and an operator has to be able to tell them apart.
    assert.equal(decision.status, 503);
  }
});

test("a configured secret is required on every request", () => {
  const env = { MENA_WORKER_TICK_SECRET: SECRET };
  for (const authorization of [undefined, "", "Bearer", "Bearer "]) {
    const decision = decideWorkerTickAccess({ authorization, env });
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, "TICK_TOKEN_MISSING");
    assert.equal(decision.status, 401);
  }
});

test("a wrong or partially-matching token is rejected, not warned", () => {
  const env = { MENA_WORKER_TICK_SECRET: SECRET };
  for (const authorization of [
    `Bearer ${SECRET.slice(0, -1)}`,
    `Bearer ${SECRET}x`,
    `Bearer ${ROTATED}`,
    SECRET, // present but not in the scheme the route documents
    `Basic ${SECRET}`,
  ]) {
    const decision = decideWorkerTickAccess({ authorization, env });
    assert.equal(decision.allowed, false, `${authorization} was accepted`);
    assert.equal(decision.code, "TICK_TOKEN_REJECTED");
    assert.equal(decision.status, 401);
  }
});

test("the token may be rotated without a window of failures", () => {
  const env = { MENA_WORKER_TICK_SECRET: `${SECRET}, ${ROTATED}` };
  assert.deepEqual(workerTickSecrets(env).length, 2);
  for (const secret of [SECRET, ROTATED]) {
    const decision = decideWorkerTickAccess({
      authorization: `Bearer ${secret}`,
      env,
    });
    assert.equal(decision.allowed, true);
  }
});

test("Vercel's own cron secret is honoured when no dedicated one is set", () => {
  // `CRON_SECRET` is what Vercel sends as `Authorization: Bearer …` for a cron
  // in vercel.json; requiring a second name for the same secret would only make
  // the wiring easy to get wrong.
  const decision = decideWorkerTickAccess({
    authorization: `Bearer ${ROTATED}`,
    env: { CRON_SECRET: ROTATED },
  });
  assert.equal(decision.allowed, true);

  // An explicit name still wins, and alone.
  const dedicated = decideWorkerTickAccess({
    authorization: `Bearer ${ROTATED}`,
    env: { MENA_WORKER_TICK_SECRET: SECRET, CRON_SECRET: ROTATED },
  });
  assert.equal(dedicated.allowed, false);
  assert.equal(dedicated.code, "TICK_TOKEN_REJECTED");
});

test("the bearer scheme is matched leniently, the token is not", () => {
  const env = { MENA_WORKER_TICK_SECRET: SECRET };
  for (const authorization of [
    `bearer ${SECRET}`,
    `  Bearer   ${SECRET}  `,
    `Bearer ${SECRET}\t`,
  ]) {
    assert.equal(
      decideWorkerTickAccess({ authorization, env }).allowed,
      true,
      `${JSON.stringify(authorization)} should have been accepted`,
    );
  }
});

test("a short value is not treated as a secret", () => {
  for (const value of ["1234", "x".repeat(23), "   ", ""]) {
    assert.deepEqual(workerTickSecrets({ MENA_WORKER_TICK_SECRET: value }), []);
    assert.equal(
      decideWorkerTickAccess({
        authorization: `Bearer ${value}`,
        env: { MENA_WORKER_TICK_SECRET: value },
      }).code,
      "TICK_DISABLED",
    );
  }
  assert.equal(workerTickSecrets({ MENA_WORKER_TICK_SECRET: "x".repeat(24) }).length, 1);
});

test("blank entries around the separators do not count", () => {
  const env = { MENA_WORKER_TICK_SECRET: `,,${SECRET},  ,` };
  assert.deepEqual(workerTickSecrets(env), [SECRET]);
});

test("the budget defaults to a value a platform timeout will not cut in half", () => {
  assert.equal(workerTickBudgetMs({}), 25_000);
  assert.equal(workerTickBudgetMs({ MENA_WORKER_TICK_BUDGET_MS: "9000" }), 9_000);
  // 0 is a real answer: "run everything, I am on a long-lived worker service".
  assert.equal(workerTickBudgetMs({ MENA_WORKER_TICK_BUDGET_MS: "0" }), 0);
  for (const garbage of ["abc", "-5", "1e999", ""]) {
    assert.equal(
      workerTickBudgetMs({ MENA_WORKER_TICK_BUDGET_MS: garbage }),
      25_000,
      `${garbage} should fall back to the default, not to no limit`,
    );
  }
});
