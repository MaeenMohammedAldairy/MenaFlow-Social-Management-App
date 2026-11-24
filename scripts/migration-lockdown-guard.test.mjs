import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Static guard: every table a migration leaves behind must be locked down —
 * `ENABLE ROW LEVEL SECURITY` plus `REVOKE ALL … FROM anon, authenticated`.
 *
 * Why a *static* guard rather than trusting review: the Supabase anon key is
 * public, because it ships inside every mobile and web build. A table created
 * without the pair defaults to RLS off with full CRUD granted to `anon`, so the
 * omission is not a style slip — it publishes that table's rows to anyone who
 * unpacks the app. Nothing else in CI would notice: Drizzle does not model RLS
 * at all (`isRLSEnabled` is `false` for every table in the schema snapshot,
 * including the ones that are locked in the database), so no generated artifact
 * flags its absence, and the lock lives only in `supabase/migrations/`.
 *
 * It has already happened twice. `20261122001000_push_notifications.sql` shipped
 * its two tables unlocked — device push tokens and notification bodies carrying
 * customer names — and was caught by measuring the live database after the fact
 * (docs/SUPABASE_DATABASE_SETUP.md §5, "Record … 2026-11-22").
 * `20261124010000_inbound_webhook_events.sql` shipped the same way and was caught
 * before it reached production. Both are fixed; this file exists so the third one
 * fails a check instead of needing a fourth write-up.
 *
 * The scan fails closed in three directions: an unlocked table fails, a
 * half-locked table (RLS on but privileges still granted) fails, and — via the
 * detector being unit-tested against deliberately planted violations below — a
 * scanner that stops recognising the shape of a `CREATE TABLE` fails too. That
 * last one matters most: a guard whose regex has rotted reports "all clear" over
 * an empty list.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Walk up to the workspace root rather than hard-coding "../..", so the guard
// survives a directory move instead of silently scanning nothing.
function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (readdirSync(dir).includes("pnpm-workspace.yaml")) return dir;
    const parent = path.dirname(dir);
    assert.notEqual(parent, dir, "could not locate the workspace root");
    dir = parent;
  }
}

const MIGRATIONS_DIR = path.join(findRepoRoot(HERE), "supabase", "migrations");

/**
 * Blanks out SQL comments, leaving string and dollar-quoted bodies intact.
 *
 * Without this the guard can be satisfied by prose: a migration that *explains*
 * the lockdown in a comment — "… carries the `ALTER TABLE … ENABLE ROW LEVEL
 * SECURITY` pair …" — would look identical to one that performs it. Both of the
 * migrations this guard was written for have such comments, so this is not a
 * hypothetical. Comment text is replaced with spaces rather than deleted so
 * statement offsets stay comparable.
 */
export function stripSqlComments(sql) {
  let out = "";
  let dollarTag = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const rest = sql.slice(i);

    if (dollarTag !== null) {
      if (rest.startsWith(dollarTag)) {
        out += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
      } else {
        out += char;
      }
      continue;
    }

    if (char === "'") {
      // SQL escapes a quote by doubling it; consume the pair as content.
      out += char;
      if (sql[i + 1] === "'") {
        out += "'";
        i += 1;
      }
      continue;
    }

    if (char === '"') {
      out += char;
      continue;
    }

    if (rest.startsWith("--")) {
      const newline = sql.indexOf("\n", i);
      const end = newline === -1 ? sql.length : newline;
      out += " ".repeat(end - i);
      i = end - 1;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      // Preserve newlines so multi-line statements stay on their own lines.
      out += sql.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop - 1;
      continue;
    }

    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      dollarTag = dollar[0];
      out += dollarTag;
      i += dollarTag.length - 1;
      continue;
    }

    out += char;
  }
  return out;
}

/**
 * One table reference: `public.mena_x`, `"mena_x"` or bare `mena_x` all name the
 * same table, and the schema qualifier is noise here because every migration in
 * this repository targets `public`.
 */
const TABLE = String.raw`(?:public\s*\.\s*)?(?:"([a-z_][a-z0-9_$]*)"|([a-z_][a-z0-9_$]*))`;
/** A `REVOKE` may name a comma-separated list of tables before its `FROM`. */
const TABLE_LIST = String.raw`(${TABLE}(?:\s*,\s*${TABLE})*)`;

const ROLE_PAIR = String.raw`(?:anon\s*,\s*authenticated|authenticated\s*,\s*anon)`;

/** Splits a captured table list into normalized names. */
function tablesIn(fragment) {
  return fragment
    .split(",")
    .map((part) => part.trim().replace(/^public\s*\.\s*/i, "").replace(/^"|"$/g, "").toLowerCase())
    .filter((name) => /^[a-z_][a-z0-9_$]*$/.test(name));
}

const STATEMENT_PATTERNS = [
  {
    kind: "create",
    pattern: new RegExp(String.raw`\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?${TABLE}`, "gi"),
    tables: (match) => tablesIn(match[1] ?? match[2]),
  },
  {
    kind: "drop",
    pattern: new RegExp(String.raw`\bdrop\s+table\s+(?:if\s+exists\s+)?${TABLE}`, "gi"),
    tables: (match) => tablesIn(match[1] ?? match[2]),
  },
  {
    kind: "enableRls",
    pattern: new RegExp(
      String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${TABLE}\s+enable\s+row\s+level\s+security`,
      "gi",
    ),
    tables: (match) => tablesIn(match[1] ?? match[2]),
  },
  {
    kind: "revoke",
    // The `TABLE` keyword is optional noise in PostgreSQL, and the repository
    // uses both spellings: `REVOKE ALL ON TABLE public.x` everywhere except
    // `20261024000000_whatsapp_group_identity.sql`, which writes
    // `REVOKE ALL ON public.x`. Accepting only one would report three locked
    // tables as exposed.
    pattern: new RegExp(
      String.raw`\brevoke\s+all\s+(?:on|privileges\s+on)\s+(?:table\s+)?${TABLE_LIST}\s+from\s+${ROLE_PAIR}\b`,
      "gi",
    ),
    tables: (match) => tablesIn(match[1]),
  },
];

function collectEvents(files) {
  const events = [];
  files.forEach((file, fileOrder) => {
    const sql = stripSqlComments(file.sql);
    for (const { kind, pattern, tables } of STATEMENT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(sql)) !== null) {
        for (const table of tables(match)) {
          events.push({ kind, table, file: file.name, fileOrder, offset: match.index });
        }
      }
    }
  });
  return events.sort(
    (a, b) => a.fileOrder - b.fileOrder || a.offset - b.offset || a.kind.localeCompare(b.kind),
  );
}

/**
 * Walks the migrations in order and reports the tables that still exist at the
 * end without the lockdown pair.
 *
 * A table only needs locking if it survives: 13 tables created by
 * `20261111002000_whatsapp_cloud_foundation.sql` were dropped by
 * `20261112001000_remove_whatsapp_cloud.sql` and correctly carry no pair. The
 * pair may also live in a *later* file than the `CREATE TABLE` — that is how the
 * original `initial_schema` tables are locked, by
 * `20261019001000_lock_down_app_tables.sql` — so the requirement is "at or after
 * the last create", not "in the same file".
 */
export function scanMigrationLockdown(files) {
  const state = new Map();

  for (const event of collectEvents(files)) {
    const entry = state.get(event.table) ?? {
      table: event.table,
      exists: false,
      enableRls: null,
      revoke: null,
      createdIn: null,
      droppedIn: null,
    };

    if (event.kind === "create") {
      // A re-create starts the requirement over: locking the previous copy says
      // nothing about the new one.
      entry.exists = true;
      entry.enableRls = null;
      entry.revoke = null;
      entry.createdIn = event.file;
      entry.droppedIn = null;
    } else if (event.kind === "drop") {
      entry.exists = false;
      entry.droppedIn = event.file;
    } else if (entry.exists) {
      if (event.kind === "enableRls" && entry.enableRls === null) {
        entry.enableRls = event.file;
      }
      if (event.kind === "revoke" && entry.revoke === null) {
        entry.revoke = event.file;
      }
    }

    state.set(event.table, entry);
  }

  const tables = [...state.values()].sort((a, b) => a.table.localeCompare(b.table));
  const existing = tables.filter((entry) => entry.exists);
  const violations = existing
    .filter((entry) => entry.enableRls === null || entry.revoke === null)
    .map((entry) => ({
      table: entry.table,
      createdIn: entry.createdIn,
      missing: [
        ...(entry.enableRls === null ? ["ENABLE ROW LEVEL SECURITY"] : []),
        ...(entry.revoke === null ? ["REVOKE ALL … FROM anon, authenticated"] : []),
      ],
    }));

  return { tables, existing, dropped: tables.filter((entry) => !entry.exists), violations };
}

function readMigrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(path.join(dir, name), "utf8") }));
}

function file(name, sql) {
  return { name, sql };
}

// ---------------------------------------------------------------------------
// The repository itself.
// ---------------------------------------------------------------------------

const repoFiles = readMigrationFiles();
const repo = scanMigrationLockdown(repoFiles);

test("every migration file is scanned", () => {
  // Detector rot: a rename or a moved directory would leave this list empty and
  // the guard would pass while checking nothing.
  assert.ok(
    repoFiles.length >= 40,
    `expected the repository's migrations to be found, scanned ${repoFiles.length} files`,
  );
  assert.ok(
    repo.existing.length >= 40,
    `expected to recognise the schema's tables, found ${repo.existing.length} in ${repoFiles.length} files`,
  );
});

test("no surviving table is left without the RLS + REVOKE lockdown", () => {
  assert.deepEqual(
    repo.violations,
    [],
    repo.violations
      .map(
        (violation) =>
          `${violation.createdIn} creates ${violation.table} but nothing adds: ${violation.missing.join(" + ")}`,
      )
      .join("\n"),
  );
});

test("the schema the migrations build is the schema the live database holds", () => {
  // A deliberate tripwire, not a drift gate: this number is the count of
  // `public` tables measured on the production project on 2026-11-24 (43), plus
  // the five rebuilt intake tables added the same day (48, of which 0 have RLS
  // off). Changing it means a migration added or removed a table, which is
  // exactly the moment the lockdown requirement applies, so it should be
  // updated by hand with the guard's verdict in front of you.
  assert.equal(
    repo.existing.length,
    48,
    `surviving tables: ${repo.existing.map((entry) => entry.table).join(", ")}`,
  );
  // The 13 WhatsApp Cloud tables were removed a day after they were added.
  assert.equal(repo.dropped.length, 13, "tables created and later dropped");
});

test("the delivery log table is locked down", () => {
  // Regression canary for the defect this guard was written for.
  const entry = repo.existing.find((table) => table.table === "mena_inbound_webhook_events");
  assert.ok(entry, "mena_inbound_webhook_events should survive the migrations");
  assert.equal(entry.enableRls, "20261124010000_inbound_webhook_events.sql");
  assert.equal(entry.revoke, "20261124010000_inbound_webhook_events.sql");
});

// ---------------------------------------------------------------------------
// The detector, against planted violations.
// ---------------------------------------------------------------------------

test("flags a table created without either half of the pair", () => {
  const scan = scanMigrationLockdown([
    file("0001_a.sql", 'CREATE TABLE public.mena_widgets (id text PRIMARY KEY);'),
  ]);
  assert.deepEqual(scan.violations, [
    {
      table: "mena_widgets",
      createdIn: "0001_a.sql",
      missing: ["ENABLE ROW LEVEL SECURITY", "REVOKE ALL … FROM anon, authenticated"],
    },
  ]);
});

test("flags a table with RLS on but privileges still granted to anon", () => {
  // Half the fix is the dangerous half: it reads as locked in a review that
  // greps for ENABLE ROW LEVEL SECURITY while `anon` keeps full CRUD.
  const scan = scanMigrationLockdown([
    file(
      "0001_a.sql",
      "CREATE TABLE public.mena_widgets (id text);\n" +
        "ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;",
    ),
  ]);
  assert.deepEqual(scan.violations, [
    {
      table: "mena_widgets",
      createdIn: "0001_a.sql",
      missing: ["REVOKE ALL … FROM anon, authenticated"],
    },
  ]);
});

test("accepts a lockdown applied by a later migration", () => {
  // The shape the original schema uses: 13 quoted, unqualified CREATE TABLEs in
  // `initial_schema`, locked by `20261019001000_lock_down_app_tables.sql`.
  const scan = scanMigrationLockdown([
    file("0001_a.sql", 'CREATE TABLE "mena_widgets" (id text);'),
    file(
      "0002_b.sql",
      "ALTER TABLE mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "REVOKE ALL ON TABLE mena_widgets FROM anon, authenticated;",
    ),
  ]);
  assert.deepEqual(scan.violations, []);
  assert.equal(scan.existing.length, 1);
  assert.equal(scan.existing[0].enableRls, "0002_b.sql");
});

test("does not require a lockdown for a table that was dropped", () => {
  const scan = scanMigrationLockdown([
    file("0001_a.sql", "CREATE TABLE public.mena_widgets (id text);"),
    file("0002_b.sql", "DROP TABLE IF EXISTS public.mena_widgets;"),
  ]);
  assert.deepEqual(scan.violations, []);
  assert.equal(scan.existing.length, 0);
  assert.equal(scan.dropped.length, 1);
});

test("requires the lockdown again after a drop and re-create", () => {
  const scan = scanMigrationLockdown([
    file(
      "0001_a.sql",
      "CREATE TABLE public.mena_widgets (id text);\n" +
        "ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "REVOKE ALL ON TABLE public.mena_widgets FROM anon, authenticated;",
    ),
    file("0002_b.sql", "DROP TABLE public.mena_widgets;"),
    file("0003_c.sql", "CREATE TABLE public.mena_widgets (id text, name text);"),
  ]);
  assert.deepEqual(
    scan.violations.map((violation) => violation.createdIn),
    ["0003_c.sql"],
  );
});

test("is not satisfied by a lockdown that only appears in a comment", () => {
  const scan = scanMigrationLockdown([
    file(
      "0001_a.sql",
      "-- Every table here carries the pair:\n" +
        "--   ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "--   REVOKE ALL ON TABLE public.mena_widgets FROM anon, authenticated;\n" +
        "CREATE TABLE public.mena_widgets (id text);\n" +
        "/* ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY; */",
    ),
  ]);
  assert.equal(scan.violations.length, 1);
  assert.deepEqual(scan.violations[0].missing, [
    "ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL … FROM anon, authenticated",
  ]);
});

test("ignores statements inside a function body", () => {
  // The schema ships a trigger function; a lockdown named in its body is prose
  // as far as the database is concerned.
  const scan = scanMigrationLockdown([
    file(
      "0001_a.sql",
      "CREATE TABLE public.mena_widgets (id text);\n" +
        "CREATE FUNCTION public.mena_widgets_guard() RETURNS trigger AS $$\n" +
        "BEGIN\n" +
        "  -- ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "  RAISE EXCEPTION 'no';\n" +
        "END;\n" +
        "$$ LANGUAGE plpgsql;",
    ),
  ]);
  assert.equal(scan.violations.length, 1);
});

test("accepts one REVOKE naming several tables at once", () => {
  // The shape `20261019001000_lock_down_app_tables.sql` uses for the 13 tables
  // from `initial_schema`: a single comma-separated statement. Matching only
  // `REVOKE ALL ON TABLE <one table>` would report all 13 as exposed.
  const scan = scanMigrationLockdown([
    file(
      "0001_a.sql",
      'CREATE TABLE "mena_widgets" (id text);\nCREATE TABLE "mena_gadgets" (id text);',
    ),
    file(
      "0002_b.sql",
      "ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "ALTER TABLE public.mena_gadgets ENABLE ROW LEVEL SECURITY;\n\n" +
        "REVOKE ALL ON TABLE\n" +
        "  public.mena_widgets,\n" +
        "  public.mena_gadgets\n" +
        "FROM anon, authenticated;",
    ),
  ]);
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(scan.existing.map((entry) => entry.revoke), ["0002_b.sql", "0002_b.sql"]);
});

test("accepts REVOKE ALL ON without the TABLE keyword", () => {
  // `20261024000000_whatsapp_group_identity.sql` writes `REVOKE ALL ON
  // public.mena_whatsapp_groups FROM anon, authenticated;`. `TABLE` is an
  // optional noise word in PostgreSQL, so the statement is effective — a guard
  // that demanded the keyword would flag three correctly locked tables.
  const scan = scanMigrationLockdown([
    file("0001_a.sql", "CREATE TABLE public.mena_widgets (id text);"),
    file(
      "0002_b.sql",
      "ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "REVOKE ALL ON public.mena_widgets FROM anon, authenticated;",
    ),
  ]);
  assert.deepEqual(scan.violations, []);
});

test("flags a REVOKE that spares one of the two public roles", () => {
  // Revoking from `anon` alone leaves `authenticated` — any signed-in user of
  // any Supabase project holding the same anon key — with full access.
  const scan = scanMigrationLockdown([
    file("0001_a.sql", "CREATE TABLE public.mena_widgets (id text);"),
    file(
      "0002_b.sql",
      "ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "REVOKE ALL ON TABLE public.mena_widgets FROM anon;",
    ),
  ]);
  assert.deepEqual(scan.violations, [
    {
      table: "mena_widgets",
      createdIn: "0001_a.sql",
      missing: ["REVOKE ALL … FROM anon, authenticated"],
    },
  ]);
});

test("recognises the qualified, quoted and bare spellings as one table", () => {
  const scan = scanMigrationLockdown([
    file("0001_a.sql", 'CREATE TABLE "mena_widgets" (id text);'),
    file(
      "0002_b.sql",
      "ALTER TABLE public.mena_widgets ENABLE ROW LEVEL SECURITY;\n" +
        "REVOKE ALL ON TABLE mena_widgets FROM authenticated, anon;",
    ),
  ]);
  assert.deepEqual(scan.violations, []);
  assert.equal(scan.tables.length, 1);
});
