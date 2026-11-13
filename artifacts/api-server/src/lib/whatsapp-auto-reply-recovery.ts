import { and, eq, lt, sql } from "drizzle-orm";
import { db, menaWhatsAppAutoReplyEvents } from "@workspace/db";
import { logger } from "./logger";

const STALE_REPLY_AFTER_MS = 2 * 60_000;

export async function markStaleWhatsAppAutoRepliesUnknown(): Promise<number> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_REPLY_AFTER_MS);
  const [requeued, failed, unknown] = await Promise.all([
    db
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: "queued",
        errorCode: "WORKER_INTERRUPTED_BEFORE_SEND",
        nextRunAt: now,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.status, "processing"),
          lt(menaWhatsAppAutoReplyEvents.leaseExpiresAt, cutoff),
          sql`${menaWhatsAppAutoReplyEvents.attempts} < 3`,
        ),
      )
      .returning({ id: menaWhatsAppAutoReplyEvents.id }),
    db
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: "failed",
        errorCode: "WORKER_RETRY_LIMIT_REACHED",
        leaseExpiresAt: null,
        completedAt: now,
      })
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.status, "processing"),
          lt(menaWhatsAppAutoReplyEvents.leaseExpiresAt, cutoff),
          sql`${menaWhatsAppAutoReplyEvents.attempts} >= 3`,
        ),
      )
      .returning({ id: menaWhatsAppAutoReplyEvents.id }),
    db
      .update(menaWhatsAppAutoReplyEvents)
      .set({
        status: "unknown",
        errorCode: "AUTO_REPLY_RESULT_UNKNOWN",
        leaseExpiresAt: null,
        completedAt: now,
      })
      .where(
        and(
          eq(menaWhatsAppAutoReplyEvents.status, "sending"),
          lt(menaWhatsAppAutoReplyEvents.leaseExpiresAt, cutoff),
        ),
      )
      .returning({ id: menaWhatsAppAutoReplyEvents.id }),
  ]);
  const recoveredCount = requeued.length + failed.length + unknown.length;
  if (recoveredCount > 0) {
    logger.warn(
      {
        requeued: requeued.length,
        failed: failed.length,
        unknown: unknown.length,
      },
      "Stale WhatsApp auto-reply leases reconciled",
    );
  }
  return recoveredCount;
}
