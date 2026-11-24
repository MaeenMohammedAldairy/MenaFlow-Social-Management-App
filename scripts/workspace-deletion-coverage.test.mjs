// ---------------------------------------------------------------------------
// Workspace erasure coverage.
//
// `deleteWorkspaceRows` in `artifacts/api-server/src/lib/workspace-deletion.ts`
// promises a merchant that a deletion request erases their workspace. It walks a
// typed list of Drizzle tables, so a table that carries a `workspace_id` but is
// missing from that list survives the erasure unless PostgreSQL cascades it.
//
// The list is maintained by hand and has already drifted once: the operational
// `mena_whatsapp_group_identity_migration_issues` table was outside both the
// list and the schema, and kept its workspace_id, owner_id and group JIDs after
// the workspace was gone. This test makes that class of omission a red build
// instead of a support ticket.
//
// A table passes when any of these holds:
//   1. it is in the typed delete list, or
//   2. it is deleted by raw SQL in the same function, or
//   3. its workspace_id has an ON DELETE CASCADE foreign key to mena_workspaces.
//
// Tables without a workspace_id column are out of scope: they are either global
// (push tokens are keyed by user_id, not workspace) or per-user.
// ---------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const migrationsDir = join(root, "supabase", "migrations");
const schemaDir = join(root, "lib", "db", "src", "schema");
const deletionFile = join(
  root,
  "artifacts",
  "api-server",
  "src",
  "lib",
  "workspace-deletion.ts",
);

const migrationSql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
  .join("\n");

// Every table any migration creates, and whether it survived later drops.
// Parenthesis balancing rather than a lazy regex: a table body legitimately
// contains nested parens (CHECK constraints, typed defaults), so a regex that
// stops at the first ");" silently truncates the body and hides its columns.
function createdTables(sql) {
  const created = new Map();
  const open = /CREATE TABLE (?:IF NOT EXISTS )?(?:"?public"?\.)?"?([a-z_]+)"?\s*\(/g;
  for (const match of sql.matchAll(open)) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < sql.length && depth > 0) {
      const char = sql[index];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      index += 1;
    }
    created.set(match[1], sql.slice(match.index + match[0].length, index - 1));
  }
  for (const match of sql.matchAll(
    /DROP TABLE (?:IF EXISTS )?(?:"?public"?\.)?"?([a-z_]+)"?/g,
  )) {
    created.delete(match[1]);
  }
  return created;
}

const tables = createdTables(migrationSql);

// Tables scoped to a workspace. `workspace_id` may also arrive via ALTER TABLE,
// so check the whole migration text for the column on that table.
function hasWorkspaceColumn(table, body) {
  if (/\bworkspace_id\b/.test(body)) return true;
  const alter = new RegExp(
    `ALTER TABLE (?:"?public"?\.)?"${table}"[\\s\\S]{0,400}?ADD COLUMN (?:IF NOT EXISTS )?workspace_id`,
  );
  return alter.test(migrationSql);
}

// ON DELETE CASCADE on a workspace_id that points at mena_workspaces, either
// inline in the table body or as a separate ALTER TABLE ... ADD CONSTRAINT.
function cascadesFromWorkspace(table, body) {
  const inline =
    /workspace_id[^,\n]*REFERENCES\s+"?public"?\."?mena_workspaces"?\s*\([^)]*\)\s*ON DELETE CASCADE/i.test(
      body,
    );
  if (inline) return true;
  const constraint = new RegExp(
    `ALTER TABLE (?:"?public"?\.)?"${table}"[\\s\\S]{0,500}?FOREIGN KEY \\("?workspace_id"?\\)\\s*REFERENCES\\s+"?public"?\."?mena_workspaces"?\\s*\\([^)]*\\)\\s*ON DELETE CASCADE`,
    "i",
  );
  return constraint.test(migrationSql);
}

// Drizzle identifier -> table name, for reading the typed delete list.
const drizzleNames = new Map();
for (const file of readdirSync(schemaDir)) {
  if (!file.endsWith(".ts")) continue;
  const source = readFileSync(join(schemaDir, file), "utf8");
  for (const match of source.matchAll(
    /export const (\w+) = pgTable\(\s*"([a-z_]+)"/g,
  )) {
    drizzleNames.set(match[1], match[2]);
  }
}

const deletionSource = readFileSync(deletionFile, "utf8");

function typedDeleteList() {
  const start = deletionSource.indexOf("for (const table of [");
  assert.notEqual(start, -1, "the typed delete loop was not found");
  const end = deletionSource.indexOf("] as const)", start);
  assert.notEqual(end, -1, "the typed delete loop is not closed");
  const identifiers = deletionSource
    .slice(start, end)
    .match(/\bmena[A-Za-z]+|\b(?:posts|products|productPosts|productExtractionSources|productExtractionSuggestions|productPublicationJobs|pushNotificationOutbox|whatsappProductExtractionJobs|workspaceSubscriptionUsage|workspaceSubscriptions|workspaceDeletionRequests|workspaceMembers|workspaceOnboarding)\b/g);
  return new Set(
    (identifiers ?? []).map((name) => drizzleNames.get(name)).filter(Boolean),
  );
}

function rawSqlDeletes() {
  return new Set(
    [...deletionSource.matchAll(/DELETE FROM public\.([a-z_]+)/g)].map(
      (match) => match[1],
    ),
  );
}

test("every workspace-scoped table is erased with its workspace", () => {
  const erased = new Set([...typedDeleteList(), ...rawSqlDeletes()]);
  const survivors = [];

  for (const [table, body] of tables) {
    if (!hasWorkspaceColumn(table, body)) continue;
    if (erased.has(table)) continue;
    if (cascadesFromWorkspace(table, body)) continue;
    survivors.push(table);
  }

  assert.deepEqual(
    survivors,
    [],
    `these tables carry a workspace_id but are neither in the delete list, nor deleted by raw SQL, nor cascaded: ${survivors.join(", ")}`,
  );
});

test("the operational identity-migration table is erased by raw SQL", () => {
  // Regression canary for the omission this guard was written for.
  assert.ok(
    rawSqlDeletes().has("mena_whatsapp_group_identity_migration_issues"),
    "mena_whatsapp_group_identity_migration_issues must be deleted explicitly: it is outside the Drizzle schema, so the typed loop cannot reach it",
  );
});

test("the guard can see the tables it reasons about", () => {
  // If the migration parser silently matched nothing, the test above would pass
  // on an empty set — the exact failure mode a coverage guard must not have.
  assert.ok(tables.size > 40, `parsed ${tables.size} tables from migrations`);
  assert.ok(typedDeleteList().size > 30, "parsed the typed delete list");
  assert.ok(
    tables.has("mena_whatsapp_group_identity_migration_issues"),
    "the operational table should be visible to the parser",
  );
});
