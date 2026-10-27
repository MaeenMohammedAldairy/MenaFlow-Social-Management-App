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

export const pool = new Pool({ connectionString: databaseUrl.toString() });
export const db = drizzle(pool, { schema });

export * from "./schema";
