import { createRequire } from "node:module";
import { planWhatsAppGroupIdentityBackfill } from "./whatsapp-group-identity-migration.mjs";

const requireApiServerDependency = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const pg = requireApiServerDependency("pg");
const { Client } = pg;
const sourceTables = [
  "mena_whatsapp_group_selections",
  "mena_whatsapp_sync_states",
  "mena_whatsapp_messages",
  "mena_whatsapp_message_media",
];
const mode = process.argv[2];

if (!["--report", "--apply"].includes(mode)) {
  throw new Error("Usage: node scripts/migrate-whatsapp-group-identities.mjs --report|--apply");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set explicitly. No environment files are loaded.");
}
if (
  mode === "--apply" &&
  (process.env.WHATSAPP_GROUP_IDENTITY_ALLOW_APPLY !== "true" ||
    process.env.NODE_ENV === "production")
) {
  throw new Error(
    "Apply is disabled unless WHATSAPP_GROUP_IDENTITY_ALLOW_APPLY=true in a non-production environment.",
  );
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

function tableRecordQuery(table) {
  return `
    SELECT '${table}'::text AS source_table, id::text AS source_row_id,
      workspace_id, owner_id, instance_name, group_jid
    FROM public.${table}
    WHERE group_id IS NULL
  `;
}

async function loadPlan() {
  const [recordsResult, connectionsResult] = await Promise.all([
    client.query(sourceTables.map(tableRecordQuery).join(" UNION ALL ")),
    client.query(`
      SELECT workspace_id, owner_id, instance_name
      FROM public.mena_whatsapp_connections
      ORDER BY workspace_id, instance_name
    `),
  ]);
  return planWhatsAppGroupIdentityBackfill(
    recordsResult.rows,
    connectionsResult.rows,
  );
}

function printReport(plan) {
  console.log(JSON.stringify({
    mode,
    exactIdentityCount: plan.identities.length,
    exactRowAssignments: plan.assignments.length,
    requiresManualReview: plan.issues.length,
    identities: plan.identities.map(({ sourceRows, ...identity }) => ({
      ...identity,
      affectedRows: sourceRows.length,
    })),
    assignments: plan.assignments,
    issues: plan.issues,
  }, null, 2));
}

async function lockForApply() {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('mena_whatsapp_group_identity_backfill', 0))");
  await client.query(`
    LOCK TABLE
      public.mena_whatsapp_connections,
      public.mena_whatsapp_groups,
      public.mena_whatsapp_group_jids,
      public.mena_whatsapp_group_selections,
      public.mena_whatsapp_sync_states,
      public.mena_whatsapp_messages,
      public.mena_whatsapp_message_media,
      public.mena_whatsapp_group_identity_migration_issues
    IN SHARE ROW EXCLUSIVE MODE
  `);
}

async function applyPlan(plan) {
  for (const identity of plan.identities) {
    const existing = await client.query(
      `SELECT group_id FROM public.mena_whatsapp_group_jids
       WHERE workspace_id = $1 AND instance_name = $2 AND group_jid = $3
       FOR UPDATE`,
      [identity.workspaceId, identity.instanceName, identity.groupJid],
    );
    let groupId = existing.rows[0]?.group_id;
    if (!groupId) {
      const inserted = await client.query(
        `INSERT INTO public.mena_whatsapp_groups
          (id, workspace_id, owner_id, instance_name, kind, name)
         VALUES (gen_random_uuid()::text, $1, $2, $3, 'unknown', $4)
         RETURNING id`,
        [
          identity.workspaceId,
          identity.ownerId,
          identity.instanceName,
          identity.name,
        ],
      );
      groupId = inserted.rows[0].id;
      await client.query(
        `INSERT INTO public.mena_whatsapp_group_jids
          (workspace_id, instance_name, group_jid, group_id, kind)
         VALUES ($1, $2, $3, $4, 'unknown')`,
        [
          identity.workspaceId,
          identity.instanceName,
          identity.groupJid,
          groupId,
        ],
      );
    }

    for (const sourceRow of identity.sourceRows) {
      await client.query(
        `UPDATE public.${sourceRow.sourceTable}
         SET group_id = $1
         WHERE id = $2 AND workspace_id = $3 AND instance_name = $4
           AND group_jid = $5 AND group_id IS NULL`,
        [
          groupId,
          sourceRow.sourceRowId,
          identity.workspaceId,
          identity.instanceName,
          identity.groupJid,
        ],
      );
    }
  }

  for (const issue of plan.issues) {
    await client.query(
      `INSERT INTO public.mena_whatsapp_group_identity_migration_issues
        (source_table, source_row_id, workspace_id, owner_id, instance_name,
         group_jid, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb)
       ON CONFLICT (source_table, source_row_id) DO UPDATE
       SET workspace_id = EXCLUDED.workspace_id,
           owner_id = EXCLUDED.owner_id,
           instance_name = EXCLUDED.instance_name,
           group_jid = EXCLUDED.group_jid,
           reason = EXCLUDED.reason,
           updated_at = now()`,
      [
        issue.sourceTable,
        issue.sourceRowId,
        issue.workspaceId,
        issue.ownerId,
        issue.instanceName,
        issue.groupJid,
        issue.reason,
      ],
    );
  }

  for (const table of sourceTables) {
    await client.query(
      `ALTER TABLE public.${table} VALIDATE CONSTRAINT ${table}_group_fk`,
    );
  }
}

try {
  await client.connect();
  if (mode === "--report") {
    await client.query("BEGIN READ ONLY");
    try {
      printReport(await loadPlan());
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      await lockForApply();
      const plan = await loadPlan();
      await applyPlan(plan);
      await client.query("COMMIT");
      printReport(plan);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.end();
}
