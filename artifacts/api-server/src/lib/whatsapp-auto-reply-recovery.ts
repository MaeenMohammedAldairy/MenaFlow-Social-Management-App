import { and, eq, lt } from "drizzle-orm";
import { db, menaWhatsAppAutoReplyEvents } from "@workspace/db";
import { logger } from "./logger";

const STALE_REPLY_AFTER_MS = 2 * 60_000;

export async function markStaleWhatsAppAutoRepliesUnknown(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_REPLY_AFTER_MS);
  const rows = await db
    .update(menaWhatsAppAutoReplyEvents)
    .set({
      status: "unknown",
      errorCode: "AUTO_REPLY_RESULT_UNKNOWN",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(menaWhatsAppAutoReplyEvents.status, "processing"),
        lt(menaWhatsAppAutoReplyEvents.createdAt, cutoff),
      ),
    )
    .returning({ id: menaWhatsAppAutoReplyEvents.id });
  if (rows.length > 0) {
    logger.warn(
      { count: rows.length },
      "Stale WhatsApp auto-reply results marked unknown; no automatic resend was attempted",
    );
  }
  return rows.length;
}
