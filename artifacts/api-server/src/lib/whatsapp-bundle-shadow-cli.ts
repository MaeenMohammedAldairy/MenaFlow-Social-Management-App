/**
 * Shadow-mode CLI — Phase 2.
 *
 *   pnpm shadow:bundles --workspace <id> --from 2026-11-24 --to 2026-11-29
 *   pnpm shadow:bundles --workspace <id> --fixture artifacts/api-server/src/lib/whatsapp-bundle-shadow.fixture.json
 *   pnpm shadow:bundles --fixture ... --out /tmp/shadow.json
 *
 * Two sources, one planner:
 *   `--fixture`  a JSON file of messages (no database at all) — used by the
 *                required cases and by anything that must be reproducible.
 *   database     a read-only SELECT of stored messages + media rows, when the
 *                operator supplies a connection string. Every statement is a
 *                SELECT; nothing is written, and the command exits non-zero if
 *                asked to do anything else.
 *
 * The legacy side is read the same way the pipeline computes it today:
 * `groupKey` from the extraction suggestion that already covers the message,
 * else the album, else the message itself. That is exactly what
 * `processProductExtractionJob` does before calling the model, so the
 * comparison is against real behaviour rather than an imitation.
 */

import { readFile, writeFile } from "node:fs/promises";

import {
  planShadowBundles,
  type ShadowBundleMessage,
} from "./whatsapp-bundle-engine.ts";
import {
  compareShadowPlan,
  type LegacyGroupReference,
} from "./whatsapp-bundle-shadow-compare.ts";

type FixtureFile = {
  evaluatedAt?: string;
  messages: ShadowBundleMessage[];
  /** Optional: what the legacy pipeline decided, per message id. */
  legacy?: Array<{
    messageId: string;
    /** Null when the legacy pipeline never queued the message. */
    groupKey: string | null;
    kind: LegacyGroupReference["kind"];
    memberMessageIds: string[];
    reason?: string | null;
  }>;
};

type Options = {
  fixturePath: string | null;
  databaseUrl: string | null;
  workspaceId: string | null;
  from: string | null;
  to: string | null;
  outPath: string | null;
  pretty: boolean;
};

function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    fixturePath: null,
    databaseUrl: process.env.DATABASE_URL ?? null,
    workspaceId: null,
    from: null,
    to: null,
    outPath: null,
    pretty: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[index + 1] ?? null;
    if (arg === "--fixture") options.fixturePath = next();
    else if (arg === "--database-url") options.databaseUrl = next();
    else if (arg === "--workspace") options.workspaceId = next();
    else if (arg === "--from") options.from = next();
    else if (arg === "--to") options.to = next();
    else if (arg === "--out") options.outPath = next();
    else if (arg === "--compact") options.pretty = false;
  }
  return options;
}

/**
 * Read-only load. Kept in this file rather than a library so the only place a
 * connection string is used is a script an operator runs by hand.
 */
async function loadFromDatabase(options: Options): Promise<{
  messages: ShadowBundleMessage[];
  legacy: NonNullable<FixtureFile["legacy"]>;
}> {
  const { default: pg } = await import("pg");
  if (!options.databaseUrl) throw new Error("DATABASE_URL_MISSING");
  if (!options.workspaceId) throw new Error("WORKSPACE_ID_MISSING");
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    // Read-only by construction. `SET TRANSACTION READ ONLY` is only legal
    // *inside* a transaction block — on its own it raises 25P01 and the whole
    // report would fail before reading a row — so the session default is set
    // first and the read runs inside an explicit read-only transaction, which
    // is what actually makes a stray write impossible.
    await client.query("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await client.query("BEGIN");
    const params: unknown[] = [options.workspaceId];
    const bounds: string[] = [];
    if (options.from) {
      params.push(options.from);
      bounds.push(`AND m.message_timestamp >= $${params.length}`);
    }
    if (options.to) {
      params.push(options.to);
      bounds.push(`AND m.message_timestamp < $${params.length}::timestamptz + interval '1 day'`);
    }
    const { rows } = await client.query(
      `
      SELECT m.id,
             m.remote_message_id    AS "remoteMessageId",
             m.workspace_id         AS "workspaceId",
             m.owner_id             AS "ownerId",
             m.instance_name        AS "instanceName",
             m.group_id             AS "groupId",
             m.group_jid            AS "groupJid",
             m.sender_id            AS "senderId",
             m.message_type         AS "messageType",
             m.text_body            AS "textBody",
             m.caption,
             m.media_available      AS "mediaAvailable",
             m.media_group_id       AS "mediaGroupId",
             m.media_group_source   AS "mediaGroupSource",
             m.media_group_expected_count AS "mediaGroupExpectedCount",
             m.media_group_index    AS "mediaGroupIndex",
             m.reply_to_remote_id   AS "replyToRemoteId",
             m.message_timestamp    AS "messageTimestamp",
             m.created_at           AS "createdAt",
             coalesce(media.rows, '[]'::json) AS media,
             legacy.group_key       AS "legacyGroupKey",
             legacy.kind            AS "legacyKind",
             coalesce(legacy.member_ids, ARRAY[m.id]::text[]) AS "legacyMembers"
        FROM mena_whatsapp_messages m
        LEFT JOIN LATERAL (
          SELECT json_agg(json_build_object('id', md.id, 'downloadStatus', md.download_status)
                          ORDER BY md.media_index) AS rows
            FROM mena_whatsapp_message_media md
           WHERE md.message_id = m.id
        ) media ON TRUE
        LEFT JOIN LATERAL (
          SELECT s.group_key,
                 -- Legacy keys predate this design: an album key is
                 -- 'album:<hash>', a bundle key is 'bundle:<hash>', but an old
                 -- single-message key is a bare hash with no prefix at all, so
                 -- the kind has to be read from the prefix rather than from
                 -- split_part (which would return the hash itself).
                 CASE
                   WHEN s.group_key LIKE 'album:%' THEN 'album'
                   WHEN s.group_key LIKE 'bundle:%' THEN 'bundle'
                   ELSE 'message'
                 END AS kind,
                 (SELECT array_agg(src.message_id)
                    FROM mena_product_extraction_sources src
                   WHERE src.suggestion_id = s.id) AS member_ids
            FROM mena_product_extraction_sources src
            JOIN mena_product_extraction_suggestions s ON s.id = src.suggestion_id
           WHERE src.message_id = m.id
           ORDER BY s.created_at DESC
           LIMIT 1
        ) legacy ON TRUE
       WHERE m.workspace_id = $1
         AND m.group_id IS NOT NULL
         AND m.message_status = 'received'
         ${bounds.join("\n         ")}
       ORDER BY m.message_timestamp, m.remote_message_id
      `,
      params,
    );
    const messages = rows.map((row: Record<string, unknown>) => ({
      ...row,
      messageTimestamp:
        row.messageTimestamp instanceof Date
          ? (row.messageTimestamp as Date).toISOString()
          : row.messageTimestamp,
      createdAt:
        row.createdAt instanceof Date
          ? (row.createdAt as Date).toISOString()
          : row.createdAt,
      media: Array.isArray(row.media) ? row.media : [],
    })) as ShadowBundleMessage[];
    const legacy = rows.map((row: Record<string, unknown>) => ({
      messageId: String(row.id),
      groupKey: (row.legacyGroupKey as string | null) ?? null,
      kind: (row.legacyKind as LegacyGroupReference["kind"] | null) ?? "none",
      memberMessageIds: (row.legacyMembers as string[] | null) ?? [String(row.id)],
    }));
    await client.query("ROLLBACK");
    return { messages, legacy };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let fixture: FixtureFile;
  if (options.fixturePath) {
    fixture = JSON.parse(await readFile(options.fixturePath, "utf8")) as FixtureFile;
  } else {
    const loaded = await loadFromDatabase(options);
    fixture = { messages: loaded.messages, legacy: loaded.legacy };
  }

  const evaluatedAt = fixture.evaluatedAt
    ? new Date(fixture.evaluatedAt)
    : new Date();
  const plan = planShadowBundles(fixture.messages, { evaluatedAt });

  const legacyByMessage = new Map<string, LegacyGroupReference>();
  for (const entry of fixture.legacy ?? []) {
    legacyByMessage.set(entry.messageId, {
      groupKey: entry.groupKey,
      kind: entry.kind,
      memberMessageIds: entry.memberMessageIds,
      reason: entry.reason ?? null,
    });
  }
  const pendingMediaByMessage = new Map<string, number>();
  for (const message of fixture.messages) {
    const pending = message.media.filter(
      (item) => item.downloadStatus !== "stored" && item.downloadStatus !== "failed",
    ).length;
    if (pending > 0) pendingMediaByMessage.set(message.id, pending);
  }

  const comparison = compareShadowPlan({
    plan,
    legacyByMessage,
    pendingMediaByMessage,
  });

  const report = {
    mode: "shadow" as const,
    wroteToDatabase: false,
    calledModel: false,
    createdJobs: 0,
    createdSuggestions: 0,
    evaluatedAt: evaluatedAt.toISOString(),
    bundles: plan.bundles.map((bundle) => ({
      id: bundle.id,
      kind: bundle.kind,
      status: bundle.status,
      evidence: bundle.evidence,
      confidence: bundle.confidence,
      mediaExpected: bundle.mediaExpected,
      mediaStored: bundle.mediaStored,
      reviewReason: bundle.reviewReason,
      memberSetHash: bundle.memberSetHash,
      members: bundle.members.map((member) => ({
        messageId: member.messageId,
        role: member.role,
        claimReason: member.claimReason,
      })),
    })),
    comparison,
  };

  const serialized = JSON.stringify(report, null, options.pretty ? 2 : 0);
  if (options.outPath) {
    await writeFile(options.outPath, serialized, "utf8");
    process.stdout.write(`shadow report written to ${options.outPath}\n`);
  } else {
    process.stdout.write(`${serialized}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
