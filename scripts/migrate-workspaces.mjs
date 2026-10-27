import pg from "pg";

const { Client } = pg;
const tenantTables = [
  "mena_meta_connections",
  "mena_oauth_states",
  "mena_whatsapp_connections",
  "mena_whatsapp_group_selections",
  "mena_whatsapp_sync_states",
  "mena_whatsapp_messages",
  "mena_whatsapp_message_media",
  "mena_posts",
  "mena_content_settings",
  "mena_content_jobs",
  "mena_post_activity_events",
];

function requireArguments() {
  if (!["--apply", "--report"].includes(process.argv[2])) {
    throw new Error("Use --report or --apply; DATABASE_URL must be set explicitly.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set explicitly. No local env files are loaded.");
  }
}

async function ensureSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS mena_workspaces_created_by_idx
      ON mena_workspaces (created_by)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS mena_workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES mena_workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT mena_workspace_members_workspace_user_key UNIQUE (workspace_id, user_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS mena_workspace_members_user_idx
      ON mena_workspace_members (user_id)
  `);

  for (const table of tenantTables) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS workspace_id TEXT`);
    const constraint = `${table}_workspace_fk`;
    await client.query(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = '${constraint}'
        ) THEN
          ALTER TABLE ${table}
            ADD CONSTRAINT ${constraint}
            FOREIGN KEY (workspace_id) REFERENCES mena_workspaces(id)
            ON DELETE RESTRICT NOT VALID;
        END IF;
      END
      $migration$
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS ${table}_workspace_id_idx ON ${table} (workspace_id)
    `);
  }
}

async function collectLegacyOwners(client) {
  const union = tenantTables
    .map(
      (table) =>
        `SELECT owner_id AS user_id FROM ${table} WHERE owner_id IS NOT NULL AND btrim(owner_id) <> ''`,
    )
    .join(" UNION ");
  const { rows } = await client.query(
    `SELECT DISTINCT user_id FROM (${union}) AS legacy_owners ORDER BY user_id`,
  );
  return rows.map((row) => row.user_id);
}

async function backfill(client) {
  const owners = await collectLegacyOwners(client);
  for (const ownerId of owners) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [ownerId],
    );
  }

  const union = tenantTables
    .map(
      (table) =>
        `SELECT owner_id AS user_id FROM ${table} WHERE owner_id IS NOT NULL AND btrim(owner_id) <> ''`,
    )
    .join(" UNION ");
  await client.query(`
    INSERT INTO mena_workspaces (id, name, created_by)
    SELECT 'ws_legacy_' || md5(owners.user_id), 'مساحة العمل', owners.user_id
    FROM (SELECT DISTINCT user_id FROM (${union}) AS known_owners) owners
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query(`
    INSERT INTO mena_workspace_members (id, workspace_id, user_id, role)
    SELECT 'wm_legacy_' || md5(workspace.id || ':' || workspace.created_by),
      workspace.id, workspace.created_by, 'owner'
    FROM mena_workspaces workspace
    WHERE workspace.id LIKE 'ws_legacy_%'
      AND NOT EXISTS (
        SELECT 1 FROM mena_workspace_members member
        WHERE member.workspace_id = workspace.id AND member.user_id = workspace.created_by
      )
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `);

  for (const table of tenantTables) {
    await client.query(`
      WITH legacy_workspaces AS (
        SELECT id AS workspace_id, created_by AS user_id
        FROM mena_workspaces
        WHERE id LIKE 'ws_legacy_%'
      )
      UPDATE ${table} AS data
      SET workspace_id = workspace.workspace_id
      FROM legacy_workspaces AS workspace
      WHERE data.owner_id = workspace.user_id
        AND data.workspace_id IS NULL
    `);
  }
}

async function reportOrphans(client) {
  const counts = [];
  for (const table of tenantTables) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${table} WHERE workspace_id IS NULL`,
    );
    counts.push({ table, count: Number(rows[0].count) });
  }
  const { rows: ambiguousRows } = await client.query(`
    SELECT COUNT(*)::bigint AS count
    FROM (
      SELECT user_id FROM mena_workspace_members
      GROUP BY user_id HAVING COUNT(*) > 1
    ) ambiguous
  `);
  return {
    counts,
    ambiguousMembershipUsers: Number(ambiguousRows[0].count),
  };
}

async function main() {
  requireArguments();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (process.argv[2] === "--report") {
      const report = await reportOrphans(client);
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    await client.query("BEGIN");
    try {
      await ensureSchema(client);
      await backfill(client);
      for (const table of tenantTables) {
        await client.query(
          `ALTER TABLE ${table} VALIDATE CONSTRAINT ${table}_workspace_fk`,
        );
      }
      const report = await reportOrphans(client);
      for (const { table, count } of report.counts) {
        if (count === 0) {
          await client.query(`ALTER TABLE ${table} ALTER COLUMN workspace_id SET NOT NULL`);
        }
      }
      await client.query("COMMIT");
      console.log("Workspace backfill completed. Orphan counts are row counts only:");
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Workspace migration failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
