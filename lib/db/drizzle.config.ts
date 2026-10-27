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

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/*",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
