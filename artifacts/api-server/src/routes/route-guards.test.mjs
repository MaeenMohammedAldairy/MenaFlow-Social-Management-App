import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Static guard: every HTTP route must either run through `requireWorkspace` or
 * be listed below with the protection it uses instead.
 *
 * Why a *static* guard rather than only per-route tests: tenant isolation in
 * this codebase lives in one place — `requireWorkspace` resolves the caller's
 * workspace and the `assert*Workspace` helpers reject foreign records — and the
 * database offers no second layer (RLS is enabled on all 42 tables but has zero
 * policies, and the server connects as the table owner, so it bypasses RLS). A
 * single new route registered without the middleware is therefore a cross-tenant
 * data leak, and nothing else in CI would notice: 43 of the 44 route files have
 * no test of their own, and two thirds of the paths are not in the OpenAPI
 * contract either.
 *
 * The scan fails closed in three directions: an unguarded route fails, a stale
 * allowlist entry fails, and — via `scanSource` being unit-tested against
 * deliberately planted violations below — a detector that stops recognising the
 * shape of a route registration fails too. That last one matters most: a guard
 * whose regex has rotted reports "all clear" over an empty list.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, "..");

// Walk up to the workspace root rather than hard-coding "../.." counts, so the
// guard survives a directory move instead of silently scanning nothing.
function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (readdirSync(dir).includes("pnpm-workspace.yaml")) return dir;
    const parent = path.dirname(dir);
    assert.notEqual(parent, dir, "could not locate the workspace root");
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(HERE);
const SCHEMA_DIR = path.join(REPO_ROOT, "lib/db/src/schema");

/* ------------------------------------------------------------------ *
 * 1. Which tables hold tenant data?
 *
 * Derived from the schema instead of being written down here, so a new table
 * is covered the moment it is declared. "Workspace-scoped" = the table has a
 * `workspaceId` column; the three that do not are the tenant root itself
 * (`workspaces`) and user-scoped push tokens.
 * ------------------------------------------------------------------ */

// Line-anchored on purpose: `lib/db/src/schema/index.ts` carries a commented-out
// example table, and a scanner that reads comments invents tables.
const TABLE_DECLARATION = /^export const ([A-Za-z_$][\w$]*) = pgTable\(\s*"([^"]+)"/gm;

function loadWorkspaceScopedTables() {
  const scoped = new Set();
  const all = new Set();
  for (const file of readdirSync(SCHEMA_DIR).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(path.join(SCHEMA_DIR, file), "utf8");
    const declarations = [...source.matchAll(TABLE_DECLARATION)];
    declarations.forEach((declaration, index) => {
      const start = declaration.index + declaration[0].length;
      const end = index + 1 < declarations.length ? declarations[index + 1].index : source.length;
      const columns = source.slice(start, end);
      all.add(declaration[1]);
      if (/\bworkspaceId\b/.test(columns)) scoped.add(declaration[1]);
    });
  }
  return { scoped, all };
}

const { scoped: WORKSPACE_TABLES, all: ALL_TABLES } = loadWorkspaceScopedTables();

/* ------------------------------------------------------------------ *
 * 2. Route-registration scanner
 * ------------------------------------------------------------------ */

const ROUTE_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|all)\s*\(/gi;
// Drizzle touches a table only through these call shapes, so matching them (and
// not bare identifiers) keeps `res.json({ posts })` from counting as a read.
const TABLE_ACCESS =
  /\b(?:from|insert|update|delete|into|innerJoin|leftJoin|rightJoin|fullJoin)\s*\(\s*([A-Za-z_$][\w$]*)/gi;
// Every handler in this codebase names its request parameter (`(req, res)`,
// `async (req: Request, res: Response)`, `(_req, res)`), which is what separates
// the middleware chain in front of the handler from the handler itself.
const HANDLER_START =
  /(?:\basync\s*)?\(\s*_?(?:req|request|res|response|ctx|next)\b[^)]*\)|\bfunction\s*\w*\s*\(/;
const GUARDS = /\brequireWorkspace\b/;

function isCommented(source, index) {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  const prefix = source.slice(lineStart, index);
  if (/^\s*\*/.test(prefix)) return true; // inside a block comment
  return /(?:^|[^:"'`\\])\/\//.test(prefix);
}

/** Read the string literal at `start`; returns its value and the index past it. */
function readLiteral(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  let value = "";
  let interpolation = 0;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "\\") {
      value += source[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (quote === "`" && char === "$" && source[i + 1] === "{") {
      value += ":param";
      i += 1;
      interpolation += 1;
      continue;
    }
    if (interpolation > 0) {
      if (char === "{") interpolation += 1;
      else if (char === "}") interpolation -= 1;
      continue;
    }
    if (char === quote) return { value, end: i + 1 };
    value += char;
  }
  return null;
}

/**
 * Scan one source file and return every route registration it declares.
 *
 * Deliberately accepts any router variable name (`router`, `app`, `apiRouter`, …)
 * and any quote style, because the guard is only worth what its detector
 * recognises. The region belonging to a route runs up to the next registration in
 * the same file, so a route's handler body is read without balancing brackets
 * across the whole call — a construct the scanner mis-reads would otherwise end
 * the call early and quietly drop the middleware chain with it.
 */
function scanSource(fileName, source) {
  const calls = [];
  for (const match of source.matchAll(ROUTE_CALL)) {
    if (isCommented(source, match.index)) continue;
    let cursor = match.index + match[0].length;
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    const literal = readLiteral(source, cursor);
    // `app.get("trust proxy")`, `cache.get(id)`: not a route.
    if (!literal || !literal.value.startsWith("/")) continue;
    // A route registration always has at least a handler after the path, so the
    // path must be followed by a comma. Without this, `cache.get("/x")` would be
    // read as a route whose "handler" is whatever code happens to follow it.
    let afterPath = literal.end;
    while (/\s/.test(source[afterPath] ?? "")) afterPath += 1;
    if (source[afterPath] !== ",") continue;
    calls.push({
      method: match[2].toUpperCase(),
      routePath: literal.value,
      bodyStart: afterPath + 1,
      registrationStart: match.index,
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return calls.map((call, index) => {
    const regionEnd =
      index + 1 < calls.length ? calls[index + 1].registrationStart : source.length;
    const region = source.slice(call.bodyStart, regionEnd);
    const handlerAt = region.search(HANDLER_START);
    const chain = handlerAt === -1 ? "" : region.slice(0, handlerAt);
    const body = handlerAt === -1 ? region : region.slice(handlerAt);

    const tables = new Set();
    const writes = new Set();
    for (const access of body.matchAll(TABLE_ACCESS)) {
      const name = access[1];
      if (!ALL_TABLES.has(name)) continue;
      tables.add(name);
      if (/\b(?:insert|update|delete|into)\s*\(/i.test(access[0])) writes.add(name);
    }

    return {
      file: fileName,
      method: call.method,
      routePath: call.routePath,
      key: `${fileName} ${call.method} ${call.routePath}`,
      line: call.line,
      chain,
      body,
      // A route whose handler could not be located is a scanner failure, not a
      // pass: the suite fails on these below rather than trusting an empty chain.
      unparsed: handlerAt === -1,
      guarded: GUARDS.test(chain),
      tables,
      writes,
    };
  });
}

function collectRegistrations() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.includes(".test.")) continue;
      const source = readFileSync(full, "utf8");
      if (!/\bRouter\s*\(|\bexpress\s*\(/.test(source)) continue;
      found.push(...scanSource(path.relative(SRC_DIR, full), source));
    }
  };
  walk(SRC_DIR);
  return found.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Routes that legitimately do not use `requireWorkspace`, keyed by
 * `<file> <METHOD> <path>`, each with the protection that applies instead.
 */
const EXEMPT = new Map([
  // Liveness/readiness probes must answer with no session at all.
  ["routes/health.ts GET /healthz", "public probe: no data, used by the platform's health check"],
  ["routes/health.ts GET /readyz", "public probe: reports dependency readiness without tenant data"],

  // Webhooks are machine callers: authenticated by signature/secret, and there
  // is no signed-in user whose workspace could be resolved.
  [
    "routes/meta-webhook.ts GET /social/meta/webhook",
    "Meta verification handshake (hub.challenge + verify token)",
  ],
  [
    "routes/meta-webhook.ts POST /social/meta/webhook",
    "Meta signature x-hub-signature-256 over the raw body",
  ],
  [
    "routes/whatsapp-sync.ts POST /social/whatsapp/webhook",
    "Evolution webhook secret (WHATSAPP_EVOLUTION_WEBHOOK_SECRET)",
  ],

  // OAuth redirect: authenticated by the stored state, not by a session.
  [
    "routes/meta.ts GET /social/meta/callback",
    "OAuth state from mena_oauth_states; workspace comes from the state record",
  ],

  // Owner console: a separate credential (MENA_OWNER_CONSOLE_TOKEN) plus its own
  // rate limiter, and cross-workspace by design — that is the job of the console.
  ["routes/owner.ts GET /session", "owner console token"],
  ["routes/owner.ts GET /overview", "owner console token"],
  ["routes/owner.ts GET /auto-replies", "owner console token"],
  ["routes/owner.ts GET /workers", "owner console token"],
  ["routes/owner.ts GET /workspaces", "owner console token"],
  ["routes/owner.ts GET /workspaces/:id", "owner console token"],

  // Public catalogue: no tenant data at all.
  ["routes/plans.ts GET /plans", "public plan catalogue"],

  // Capability URLs: signed, expiring links used as media src in webviews and by
  // Meta's scraper, which cannot send the merchant's session.
  [
    "routes/product-media.ts GET /social/products/public-media/:mediaId",
    "signed media URL (verifySignedMediaRequest: mediaId + expires + signature + variant)",
  ],
  [
    "routes/whatsapp-messages.ts GET /social/whatsapp/public-media/:mediaId",
    "signed media URL (verifySignedMediaRequest)",
  ],

  // Device-scoped, authenticated by user: a push token belongs to a device that
  // serves every workspace its owner belongs to, and registration must also work
  // during onboarding, before a workspace row exists.
  [
    "routes/push-notifications.ts POST /notifications/push-token",
    "authenticated by requestOwnerId; 401 without it",
  ],
  ["routes/push-notifications.ts GET /notifications/push-tokens", "authenticated by requestOwnerId"],
  [
    "routes/push-notifications.ts DELETE /notifications/push-token",
    "authenticated by requestOwnerId",
  ],

  // Lists the caller's own workspaces: the workspace is the result, not a
  // precondition, so there is nothing to scope yet.
  [
    "routes/workspaces.ts GET /workspaces",
    "authenticated by user; returns only that user's memberships",
  ],
]);

/**
 * Known limit of a static scan: it sees tables a handler touches *directly*. A
 * handler that delegates its writes to a helper in `src/lib` (the Evolution
 * webhook does) is judged on its chain alone. That is acceptable because the
 * invariant being locked is "middleware present or documented exemption", not
 * "every SQL statement traced" — and the exemption list is what a reviewer reads.
 */

/**
 * The only routes allowed to *write* tenant data without `requireWorkspace`.
 * Anything else that turns up here is a cross-tenant write, not a design choice.
 */
const SANCTIONED_WRITERS = new Set([
  // Consumes a single-use, expiring, hashed OAuth state (`delete … returning`)
  // and takes the workspace from that row, so the write is state-authenticated.
  "routes/meta.ts GET /social/meta/callback",
  "routes/meta-webhook.ts POST /social/meta/webhook",
  "routes/whatsapp-sync.ts POST /social/whatsapp/webhook",
  "routes/push-notifications.ts POST /notifications/push-token",
  "routes/push-notifications.ts DELETE /notifications/push-token",
]);

const registrations = collectRegistrations();

/* ------------------------------------------------------------------ *
 * 3. The detector must actually detect — planted violations
 * ------------------------------------------------------------------ */

test("the scanner catches a violation on a router it has never seen", () => {
  // This is the blind spot the guard originally had: it only recognised
  // variables named `router`/`app`, so a new file using `apiRouter.get(...)`
  // would have escaped silently and reported "all clear".
  const source = [
    'import { Router } from "express";',
    "export const apiRouter = Router({ mergeParams: true });",
    'apiRouter.get("/canary", async (_req, res) => {',
    "  const rows = await db.select().from(menaOrders);",
    "  res.json(rows);",
    "});",
  ].join("\n");

  const [route] = scanSource("routes/canary.ts", source);
  assert.ok(route, "الماسح لم يتعرّف على مسار معرَّف على متغيّر باسم غير router/app");
  assert.equal(route.routePath, "/canary");
  assert.equal(route.guarded, false);
  assert.deepEqual([...route.tables], ["menaOrders"]);
});

test("the scanner accepts a guard wherever the codebase writes one", () => {
  const source = [
    'router.post("/guarded", requireWorkspace, async (req, res) => {',
    "  await db.insert(menaOrders).values({ workspaceId: req.workspace.id });",
    "  res.status(201).json({ ok: true });",
    "});",
    "router.get('/single-quoted', requireWorkspace, async (req, res) => {",
    "  res.json({ ok: true });",
    "});",
    "router.patch(`/template/${postId}/status`, requireWorkspace, async (req, res) => {",
    "  await db.update(posts).set({ status: 'published' });",
    "  res.json({ ok: true });",
    "});",
  ].join("\n");

  const routes = scanSource("routes/guarded.ts", source);
  assert.equal(routes.length, 3, "المسارات ذات الاقتباس المفرد أو القالب النصّي لم تُكتشف");
  assert.ok(routes.every((route) => route.guarded), "مسار محميّ اعتُبر غير محميّ");
  assert.equal(routes[0].routePath, "/guarded");
  assert.equal(routes[1].routePath, "/single-quoted");
  assert.equal(routes[2].routePath, "/template/:param/status");
  assert.deepEqual([...routes[0].writes], ["menaOrders"]);
  assert.deepEqual([...routes[2].writes], ["posts"]);
  assert.ok(routes.every((route) => !route.unparsed), "مسار لم يُعرف مكان معالجه");
});

test("the scanner ignores things that are not routes", () => {
  const source = [
    'const setting = app.get("trust proxy");',
    'const header = req.get("x-hub-signature-256");',
    'const cached = cache.get("/not-a-route");',
    "// router.get('/commented-out', async (req, res) => { await db.select().from(posts); });",
    'app.use("/api", apiRateLimit);',
    'router.use("/owner", ownerRouter);',
  ].join("\n");

  assert.deepEqual(scanSource("routes/noise.ts", source), []);
});

test("the scanner reads joins and updates as table access too", () => {
  const source = [
    'router.get("/joined", requireWorkspace, async (req, res) => {',
    "  const rows = await db",
    "    .select()",
    "    .from(menaOrders)",
    "    .leftJoin(menaOrderItems, eq(menaOrderItems.orderId, menaOrders.id));",
    "  await db.update(workspaceMembers).set({ role: 'owner' });",
    "  res.json(rows);",
    "});",
  ].join("\n");

  const [route] = scanSource("routes/joined.ts", source);
  assert.deepEqual(
    [...route.tables].sort(),
    ["menaOrderItems", "menaOrders", "workspaceMembers"],
    "الانضمامات (joins) والتحديثات لا تُحتسب وصولاً لبيانات المستأجر",
  );
});

/* ------------------------------------------------------------------ *
 * 4. The invariant over the real HTTP surface
 * ------------------------------------------------------------------ */

test("the scan still sees the whole HTTP surface", () => {
  // If route registrations ever change shape, these fail instead of the suite
  // passing over an empty list.
  assert.ok(
    registrations.length >= 95,
    `expected at least 95 route registrations, scanned ${registrations.length}`,
  );
  const files = new Set(registrations.map((entry) => entry.file));
  assert.ok(files.size >= 30, `expected at least 30 route files, saw ${files.size}`);
  assert.ok(
    WORKSPACE_TABLES.size >= 35,
    `expected at least 35 workspace-scoped tables, derived ${WORKSPACE_TABLES.size}`,
  );
  assert.ok(
    registrations.some((entry) => entry.tables.size > 0),
    "no route was seen touching a tenant table — the table detector has rotted",
  );
});

test("the scanner located the handler of every route it found", () => {
  // An unlocated handler means the chain was never read, so "guarded" would be a
  // guess. Fail loudly instead of passing over an empty chain.
  const unparsed = registrations.filter((entry) => entry.unparsed);
  assert.deepEqual(
    unparsed.map((entry) => `${entry.key} (${entry.file}:${entry.line})`),
    [],
    "لم يتم العثور على معالج هذه المسارات — الماسح يحتاج تحديثًا ليطابق شكل التعريف الجديد",
  );
});

test("every route is workspace-scoped or explicitly exempt", () => {
  const unguarded = registrations.filter((entry) => !entry.guarded && !EXEMPT.has(entry.key));
  assert.deepEqual(
    unguarded.map((entry) => `${entry.key} (${entry.file}:${entry.line})`),
    [],
    "هذه المسارات لا تمرّ عبر requireWorkspace وليست في قائمة الاستثناءات الموثّقة — " +
      "أضف الوسيط (الافتراضي الصحيح) أو وثّق الحماية البديلة في EXEMPT",
  );
});

test("no exempt route writes tenant data unless it is a sanctioned machine caller", () => {
  const risky = registrations.filter(
    (entry) => !entry.guarded && entry.writes.size > 0 && !SANCTIONED_WRITERS.has(entry.key),
  );
  assert.deepEqual(
    risky.map((entry) => `${entry.key} writes ${[...entry.writes].join(", ")}`),
    [],
    "كتابة في جداول مستأجر آخر بلا requireWorkspace: هذه أخطر من القراءة وليست استثناءً مقبولاً",
  );
});

test("the exemption list has no stale entries", () => {
  const keys = new Set(registrations.map((entry) => entry.key));
  const stale = [...EXEMPT.keys()].filter((key) => !keys.has(key));
  assert.deepEqual(
    stale,
    [],
    "هذه الاستثناءات لم تعد تطابق أي مسار موجود — احذفها حتى لا تتراكم ثغرات معتمدة",
  );
  const sanctionedStale = [...SANCTIONED_WRITERS].filter((key) => !EXEMPT.has(key));
  assert.deepEqual(sanctionedStale, [], "SANCTIONED_WRITERS holds a key that is not exempt");
});

test("every exemption states the protection that replaces workspace scoping", () => {
  for (const [key, reason] of EXEMPT) {
    assert.ok(reason.trim().length >= 12, `${key}: سبب الاستثناء قصير أو فارغ`);
  }
});

test("tenant-data routes are the norm, and the exceptions are a short list", () => {
  // A readable summary of the isolation posture; if this ratio ever swings it
  // means routes started bypassing the middleware wholesale.
  const touching = registrations.filter((entry) => entry.tables.size > 0);
  const unguardedTenants = touching.filter((entry) => !entry.guarded);
  assert.ok(
    touching.length >= 60,
    `expected at least 60 routes touching tenant tables, saw ${touching.length}`,
  );
  assert.deepEqual(
    unguardedTenants.map((entry) => entry.key),
    unguardedTenants.filter((entry) => EXEMPT.has(entry.key)).map((entry) => entry.key),
    "مسار يلمس جداول المستأجر بلا حماية وبلا استثناء موثّق",
  );
});
