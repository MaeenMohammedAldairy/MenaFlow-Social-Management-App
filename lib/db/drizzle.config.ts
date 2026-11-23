import { defineConfig } from "drizzle-kit";
import path from "path";

for (const f of [
  path.resolve(__dirname, "../../.env"),
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, ".env"),
]) {
  try {
    process.loadEnvFile(f);
  } catch (_) {}
}

// `drizzle-kit generate` only reads src/schema/* and writes SQL — it never
// connects — so it must work without a provisioned database. CI relies on that
// to run the drift gate below. `push` does connect and keeps failing fast.
const needsDatabase = !process.argv.includes("generate");

if (needsDatabase && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/*",
  dialect: "postgresql",
  // Called `schema-snapshot` rather than drizzle's default `drizzle` on purpose:
  // this folder is a CI baseline for detecting drift, and it is NEVER applied to
  // any database. The DDL that actually runs lives in supabase/migrations/,
  // which is the single source of truth for schema changes. Regenerating the
  // snapshot after editing src/schema/* is what makes a missing migration visible
  // in CI instead of in production.
  out: "./schema-snapshot",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
