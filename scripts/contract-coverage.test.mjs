// ---------------------------------------------------------------------------
// API contract coverage.
//
// `lib/api-spec/openapi.yaml` is the only place an endpoint's request and
// response shapes are written down; `pnpm --filter @workspace/api-spec codegen`
// turns it into the Zod schemas and the React Query client. An operation that
// exists in Express but not in the contract is invisible to that pipeline: no
// schema, no generated client, no drift check — the mobile app ends up carrying
// a hand-written copy of its types, which is how 14 of those copies drifted from
// the wire format.
//
// CI already gates the *generated client* against the contract. Nothing gated
// the *server* against the contract, which is why 62 operations accumulated
// outside it. This is that gate.
//
// Two rules:
//
//   1. The ratchet. `MINIMUM_COVERED` only ever goes up. Lowering it is how a
//      coverage gate becomes decoration.
//   2. The backlog. `UNDOCUMENTED` is the frozen list of what is still missing.
//      Documenting an entry is welcome and fails the test on purpose — remove it
//      from the list in the same commit. Adding an undocumented operation fails
//      immediately, which is the actual point.
//
// `/owner/*` is listed but excluded from the count: the owner console is an
// internal read-only SPA served from the same process, not a merchant-facing
// contract. Everything else must be documented or added here deliberately.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const routesDir = join(root, "artifacts", "api-server", "src", "routes");
const specPath = join(root, "lib", "api-spec", "openapi.yaml");

/** Highest coverage reached so far: 73 of 99. Raise it, never lower it. */
const MINIMUM_COVERED = 73;

/**
 * Paths excluded from the count. The owner console is an internal read-only SPA
 * served from the same process, not a merchant-facing contract; `/webhook` paths
 * are provider callbacks that Evolution and Meta call, so they have no client to
 * generate and no request body of ours to validate.
 */
const OUT_OF_CONTRACT = [/^\/owner(?:\/|$)/, /\/webhook$/];

/** Everything still undocumented. Shrink it; do not grow it. */
const UNDOCUMENTED = [
  ["account-details", "GET /social/account-details/:platform"],
  ["health", "GET /readyz"],
  ["meta-auto-replies", "GET /social/meta-auto-replies/historical-comments"],
  ["meta-auto-replies", "POST /social/meta-auto-replies/historical-comments"],
  ["meta-auto-replies", "POST /social/meta-auto-replies/test"],
  ["meta-auto-replies", "PUT /social/meta-auto-replies"],
  ["meta-inbox-replies", "POST /social/meta-inbox/items/:id/auto-reply"],
  ["meta-inbox-replies", "POST /social/meta-inbox/items/:id/reply"],
  ["meta-inbox-replies", "POST /social/meta-inbox/items/:id/retry-confirmation"],
  ["meta-inbox", "GET /social/meta-inbox"],
  ["owner", "GET /auto-replies"],
  ["owner", "GET /overview"],
  ["owner", "GET /session"],
  ["owner", "GET /workers"],
  ["owner", "GET /workspaces/:id"],
  ["plans", "GET /plans"],
  ["posts-publishing", "POST /posts/:id/publish"],
  ["posts-publishing", "POST /posts/:id/verify-facebook"],
  ["posts-read", "GET /posts/events"],
  ["posts-whatsapp", "POST /posts/from-message"],
  ["posts-workflow", "GET /posts/auto-publish-settings"],
  ["posts-workflow", "POST /posts/process-whatsapp-backlog"],
  ["posts-workflow", "PUT /posts/auto-publish-settings"],
  ["whatsapp-content-associations", "POST /social/whatsapp/content-associations"],
  ["whatsapp-direct-inbox", "GET /social/whatsapp/direct-conversations"],
  ["whatsapp-direct-inbox", "GET /social/whatsapp/direct-messages"],
  ["whatsapp-direct-inbox", "POST /social/whatsapp/direct-messages/:id/confirm-not-sent"],
  ["whatsapp-direct-inbox", "POST /social/whatsapp/direct-messages/reply"],
  ["whatsapp-messages", "GET /social/whatsapp/media/:mediaId"],
  ["whatsapp-messages", "GET /social/whatsapp/public-media/:mediaId"],
  ["workspaces", "GET /workspaces/current"],
];

// Express path params (`:id`) and OpenAPI path params (`{id}`) name the same
// thing; normalise both before comparing, or nothing ever matches.
function normalise(path) {
  return path.replace(/:[A-Za-z0-9_]+/g, "{}").replace(/\{[A-Za-z0-9_]+\}/g, "{}");
}

function serverOperations() {
  const operations = [];
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(routesDir, file), "utf8");
    const pattern = /\b(?:router|r)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
    for (const match of source.matchAll(pattern)) {
      operations.push({
        file: file.replace(/\.ts$/, ""),
        method: match[1].toUpperCase(),
        path: match[3],
      });
    }
  }
  return operations;
}

function contractOperations() {
  const documented = new Set();
  let currentPath = null;
  for (const line of readFileSync(specPath, "utf8").split("\n")) {
    const pathLine = /^  (\/[^:]*):\s*$/.exec(line);
    if (pathLine) {
      currentPath = pathLine[1];
      continue;
    }
    const methodLine = /^    (get|post|put|patch|delete):/.exec(line);
    if (methodLine && currentPath) {
      documented.add(`${methodLine[1].toUpperCase()} ${normalise(currentPath)}`);
    }
  }
  return documented;
}

function key(operation) {
  return `${operation.method} ${normalise(operation.path)}`;
}

test("every Express operation is either in the contract or on the known backlog", () => {
  const documented = contractOperations();
  const operations = serverOperations();

  const unexpected = operations.filter(
    (operation) =>
      !documented.has(key(operation)) &&
      !UNDOCUMENTED.some(
        ([file, route]) => normalise(route) === key(operation) && file === operation.file,
      ) &&
      !OUT_OF_CONTRACT.some((pattern) => pattern.test(operation.path)),
  );

  assert.deepEqual(
    unexpected.map((operation) => `${operation.file}: ${key(operation)}`),
    [],
    "new operations must be added to lib/api-spec/openapi.yaml (preferred) or, with a reason, to UNDOCUMENTED in this test",
  );
});

test("contract coverage never regresses", () => {
  const documented = contractOperations();
  const operations = serverOperations().filter(
    (operation) => !OUT_OF_CONTRACT.some((pattern) => pattern.test(operation.path)),
  );
  const covered = operations.filter((operation) => documented.has(key(operation)));

  assert.ok(
    covered.length >= MINIMUM_COVERED,
    `contract covers ${covered.length} of ${operations.length} merchant-facing operations; the floor is ${MINIMUM_COVERED}`,
  );
});

test("documented operations are removed from the backlog", () => {
  // The backlog is a to-do list, not a museum. An entry that is already in the
  // contract means the list is stale and the next reader will trust it wrongly.
  const documented = contractOperations();
  const stale = UNDOCUMENTED.filter(([, route]) => documented.has(normalise(route)));

  assert.deepEqual(
    stale.map(([, route]) => route),
    [],
    "these are already documented — remove them from UNDOCUMENTED",
  );
});

test("the gate can see both sides", () => {
  // A parser that silently matches nothing would make both tests above pass on
  // empty sets, which is the one failure mode a coverage gate cannot have.
  const operations = serverOperations();
  assert.ok(operations.length > 90, `parsed ${operations.length} server operations`);
  assert.ok(contractOperations().size > 40, `parsed ${contractOperations().size} contract operations`);
  assert.ok(UNDOCUMENTED.length > 25, `backlog holds ${UNDOCUMENTED.length} entries`);

  // The two lists must account for every merchant-facing operation between them,
  // with nothing in both. If the sum is short, an operation is in neither list and
  // test 1 should have caught it; if it is over, something is counted twice.
  const merchantFacing = operations.filter(
    (operation) => !OUT_OF_CONTRACT.some((pattern) => pattern.test(operation.path)),
  );
  const documented = contractOperations();
  const covered = merchantFacing.filter((operation) => documented.has(key(operation))).length;
  assert.equal(
    covered + UNDOCUMENTED.length,
    merchantFacing.length,
    `covered (${covered}) + backlog (${UNDOCUMENTED.length}) must equal the ${merchantFacing.length} merchant-facing operations`,
  );
});
