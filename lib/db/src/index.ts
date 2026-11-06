import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import path from "path";

if (!process.env.DATABASE_URL) {
  for (const f of [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../.env"),
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(__dirname, "../../../.env"),
    path.resolve(__dirname, "../../../../.env"),
  ]) {
    try {
      process.loadEnvFile(f);
      if (process.env.DATABASE_URL) break;
    } catch (_) {}
  }
}

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = new URL(process.env.DATABASE_URL);
const isSupabaseHost =
  /(^|\.)supabase\.co$/i.test(databaseUrl.hostname) ||
  /(^|\.)pooler\.supabase\.com$/i.test(databaseUrl.hostname);
if (!isSupabaseHost) {
  throw new Error("DATABASE_URL must point to Supabase; local database connections are disabled.");
}

function envPositiveInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export const pool = new Pool({
  connectionString: databaseUrl.toString(),
  // Bounded pool: each server replica consumes at most DB_POOL_MAX connections
  // instead of pg's unbounded defaults; keep total across replicas under the
  // Supabase connection ceiling.
  max: envPositiveInt("DB_POOL_MAX") ?? 10,
  connectionTimeoutMillis: envPositiveInt("DB_CONNECTION_TIMEOUT_MS") ?? 10_000,
  idleTimeoutMillis: envPositiveInt("DB_IDLE_TIMEOUT_MS") ?? 30_000,
  statement_timeout: envPositiveInt("DB_STATEMENT_TIMEOUT_MS") ?? 30_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
