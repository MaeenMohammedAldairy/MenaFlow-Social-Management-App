/**
 * export-product-review-fixtures.mjs
 *
 * Exports the merchant field reviews stored on product extraction suggestions as
 * benchmark fixtures, and prints the per-field accuracy they imply.
 *
 *   pnpm run db:export:product-review-fixtures
 *   pnpm run db:export:product-review-fixtures -- --dry-run
 *   pnpm run db:export:product-review-fixtures -- --workspace=<id> --out=<path>
 *
 * The output is replayed by
 * artifacts/api-server/src/lib/product-extraction-review-corpus.test.mjs, so a
 * prompt or model change can be measured against what merchants actually
 * corrected instead of against synthetic cases only. Identifiers are hashed by
 * the fixture builder; message text is included because a fixture without the
 * source text cannot be replayed.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  reviewFixturesFromSuggestions,
  serializeReviewFixtures,
  summarizeReviewVerdicts,
} from "../artifacts/api-server/src/lib/product-extraction-fixtures.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const defaultOutput = path.join(
  repoRoot,
  "artifacts/api-server/src/lib/product-extraction.reviewed.jsonl",
);

for (const file of [
  path.resolve(__dirname, "../.env"),
  path.resolve(__dirname, "../../.env"),
]) {
  try {
    process.loadEnvFile(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const flag = (name) => {
  const prefix = `--${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
};
const workspaceFilter = flag("workspace");
const outputPath = flag("out") ? path.resolve(flag("out")) : defaultOutput;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required to export product review fixtures.",
  );
}

const { Client } = createRequire(
  path.resolve(__dirname, "../lib/db/package.json"),
)("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const suggestionQuery = `
      SELECT
        suggestion.id,
        suggestion.workspace_id,
        suggestion.classification,
        suggestion.extracted_data,
        suggestion.evidence,
        suggestion.confidence,
        suggestion.field_review,
        suggestion.ai_model,
        suggestion.reviewed_at
      FROM mena_product_extraction_suggestions AS suggestion
      WHERE suggestion.field_review IS NOT NULL
        AND suggestion.field_review <> '{}'::jsonb
        AND ($1::text IS NULL OR suggestion.workspace_id = $1)
      ORDER BY suggestion.created_at
    `;
    const { rows: suggestionRows } = await client.query(suggestionQuery, [
      workspaceFilter,
    ]);
    if (suggestionRows.length === 0) {
      console.log("No reviewed extraction suggestions found.");
      return;
    }

    const { rows: sourceRows } = await client.query(
      `
        SELECT
          source.suggestion_id,
          message.id AS message_id,
          message.group_id,
          message.message_timestamp,
          COALESCE(message.text_body, message.caption, '') AS text
        FROM mena_product_extraction_sources AS source
        JOIN mena_whatsapp_messages AS message
          ON message.id = source.message_id
          AND message.workspace_id = source.workspace_id
        WHERE source.suggestion_id = ANY($1::text[])
        ORDER BY message.message_timestamp, message.id
      `,
      [suggestionRows.map((row) => row.id)],
    );
    const sourcesBySuggestion = new Map();
    for (const row of sourceRows) {
      const current = sourcesBySuggestion.get(row.suggestion_id) ?? [];
      current.push({
        id: row.message_id,
        // The bundle key the worker used is not stored; the group is the
        // closest stable grouping and is all the normalizer needs to refuse a
        // cross-group merge.
        groupId: row.group_id ?? `message:${row.message_id}`,
        messageTimestamp: row.message_timestamp
          ? new Date(row.message_timestamp).toISOString()
          : null,
        replyToMessageId: null,
        text: row.text ?? "",
      });
      sourcesBySuggestion.set(row.suggestion_id, current);
    }

    const suggestions = suggestionRows.map((row) => ({
      id: row.id,
      classification: row.classification,
      extractedData: row.extracted_data,
      evidence: row.evidence ?? {},
      confidence: row.confidence ?? {},
      fieldReview: row.field_review ?? {},
      aiModel: row.ai_model,
      reviewedAt: row.reviewed_at
        ? new Date(row.reviewed_at).toISOString()
        : null,
      sources: sourcesBySuggestion.get(row.id) ?? [],
    }));

    const fixtures = reviewFixturesFromSuggestions(suggestions);
    const summary = summarizeReviewVerdicts(suggestions);
    console.log(
      `Reviewed suggestions: ${summary.reviewed}/${summary.suggestions}`,
    );
    console.log(
      `Verdicts: ${summary.verdicts} (correct ${summary.correct}, incorrect ${summary.incorrect})`,
    );
    for (const [field, counts] of Object.entries(summary.byField)) {
      const total = counts.correct + counts.incorrect;
      const accuracy = total ? Math.round((counts.correct / total) * 100) : 0;
      console.log(
        `  ${field.padEnd(14)} correct ${String(counts.correct).padStart(3)} / ${String(total).padStart(3)}  (${accuracy}%)`,
      );
    }
    console.log(`Replayable fixtures: ${fixtures.length}`);

    if (dryRun) {
      console.log(`--dry-run: not writing ${path.relative(repoRoot, outputPath)}`);
      return;
    }
    if (fixtures.length === 0) {
      console.log("Nothing replayable to write (no source text stored).");
      return;
    }
    await writeFile(outputPath, serializeReviewFixtures(fixtures), "utf8");
    console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
  } finally {
    await client.end();
  }
}

await main();
