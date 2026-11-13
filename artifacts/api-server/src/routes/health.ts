import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    const schemaResult = await db.execute(sql`
      SELECT COALESCE(
        array_agg(required.table_name || '.' || required.column_name),
        ARRAY[]::text[]
      ) AS missing
      FROM (VALUES
        ('mena_orders', 'source_whatsapp_instance_name'),
        ('mena_orders', 'whatsapp_confirmation_status'),
        ('mena_order_items', 'order_id'),
        ('mena_whatsapp_direct_messages', 'encrypted_text_body'),
        ('mena_whatsapp_direct_messages', 'expires_at'),
        ('mena_whatsapp_order_intakes', 'encrypted_customer_data'),
        ('mena_whatsapp_order_intakes', 'expires_at'),
        ('mena_whatsapp_auto_reply_events', 'attempts'),
        ('mena_whatsapp_auto_reply_events', 'next_run_at'),
        ('mena_whatsapp_auto_reply_events', 'lease_expires_at')
      ) AS required(table_name, column_name)
      LEFT JOIN information_schema.columns AS installed
        ON installed.table_schema = 'public'
        AND installed.table_name = required.table_name
        AND installed.column_name = required.column_name
      WHERE installed.column_name IS NULL
    `);
    const firstRow = schemaResult.rows[0] as { missing?: unknown } | undefined;
    const missing = Array.isArray(firstRow?.missing)
      ? firstRow.missing.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (missing.length > 0) {
      logger.error({ missing }, "Readiness check found unapplied database migrations");
      res.status(503).json({ status: "error", missingSchema: missing });
      return;
    }
    res.json({ status: "ok" });
  } catch (err) {
    logger.error({ err }, "Readiness check failed");
    res.status(503).json({ status: "error" });
  }
});

export default router;
