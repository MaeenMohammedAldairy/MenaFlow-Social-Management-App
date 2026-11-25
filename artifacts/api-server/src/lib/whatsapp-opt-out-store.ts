/**
 * whatsapp-opt-out-store.ts
 *
 * Drizzle-backed implementation of the consent store. One row per
 * (workspace, customer) is guaranteed by the partial schema below; opt-out and
 * opt-in update that row, never insert a second one.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, menaWhatsAppOptOuts, pool } from "@workspace/db";
import type {
  WhatsAppConsentLock,
  WhatsAppOptOutRecord,
  WhatsAppOptOutStore,
} from "./whatsapp-opt-out.ts";

type StoredRow = typeof menaWhatsAppOptOuts.$inferSelect;

function toRecord(row: StoredRow): WhatsAppOptOutRecord {
  return {
    workspaceId: row.workspaceId,
    customerId: row.customerId,
    optedOutAt: row.optedOutAt,
    optedInAt: row.optedInAt,
  };
}

export const whatsAppOptOutStore: WhatsAppOptOutStore = {
  async find({ workspaceId, customerId }) {
    const [row] = await db
      .select()
      .from(menaWhatsAppOptOuts)
      .where(
        and(
          eq(menaWhatsAppOptOuts.workspaceId, workspaceId),
          eq(menaWhatsAppOptOuts.customerId, customerId),
        ),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  },

  async optOut({ ownerId, workspaceId, customerId, at }) {
    const [row] = await db
      .insert(menaWhatsAppOptOuts)
      .values({
        id: randomUUID(),
        ownerId,
        workspaceId,
        customerId,
        optedOutAt: at,
        optedInAt: null,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: [menaWhatsAppOptOuts.workspaceId, menaWhatsAppOptOuts.customerId],
        set: { optedOutAt: at, optedInAt: null, updatedAt: at },
      })
      .returning();
    return toRecord(row!);
  },

  async optIn({ ownerId, workspaceId, customerId, at }) {
    const [existing] = await db
      .select({ id: menaWhatsAppOptOuts.id })
      .from(menaWhatsAppOptOuts)
      .where(
        and(
          eq(menaWhatsAppOptOuts.workspaceId, workspaceId),
          eq(menaWhatsAppOptOuts.customerId, customerId),
        ),
      )
      .limit(1);
    if (!existing) {
      // Keep the opt-out timestamp as history even when a deployment has no
      // prior row for this customer; one row is created for the audit trail.
      const [row] = await db
        .insert(menaWhatsAppOptOuts)
        .values({
          id: randomUUID(),
          ownerId,
          workspaceId,
          customerId,
          optedOutAt: at,
          optedInAt: at,
          updatedAt: at,
        })
        .onConflictDoNothing()
        .returning();
      if (row) return toRecord(row);
    }
    const [row] = await db
      .update(menaWhatsAppOptOuts)
      .set({ optedInAt: at, updatedAt: at })
      .where(
        and(
          eq(menaWhatsAppOptOuts.workspaceId, workspaceId),
          eq(menaWhatsAppOptOuts.customerId, customerId),
        ),
      )
      .returning();
    return toRecord(row!);
  },
};

/** Session-scoped so the lock covers an external send, not just one query. */
export const whatsAppOptOutLock: WhatsAppConsentLock = {
  async run(key, run) {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        key,
      ]);
      try {
        return await run();
      } finally {
        await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
          key,
        ]);
      }
    } finally {
      client.release();
    }
  },
};
