import { and, eq, isNull } from "drizzle-orm";
import { db, menaMetaAutoReplyJobs, menaMetaInboxItems } from "@workspace/db";

const replyLeaseMs = 90_000;

export type MetaInboxReplyReservation =
  "reserved" | "in_progress" | "unknown" | "already_replied" | "missing";

export async function reserveMetaInboxReply(
  workspaceId: string,
  itemId: string,
): Promise<MetaInboxReplyReservation> {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const [item] = await transaction
      .select({
        replyText: menaMetaInboxItems.replyText,
        replyStatus: menaMetaInboxItems.replyStatus,
        replyAttemptStartedAt: menaMetaInboxItems.replyAttemptStartedAt,
      })
      .from(menaMetaInboxItems)
      .where(
        and(
          eq(menaMetaInboxItems.id, itemId),
          eq(menaMetaInboxItems.workspaceId, workspaceId),
        ),
      )
      .for("update");

    if (!item) return "missing";
    if (item.replyText) return "already_replied";
    if (item.replyStatus === "unknown") return "unknown";
    if (item.replyStatus === "sending") {
      if (
        !item.replyAttemptStartedAt ||
        now.getTime() - item.replyAttemptStartedAt.getTime() < replyLeaseMs
      ) {
        return "in_progress";
      }

      await transaction
        .update(menaMetaInboxItems)
        .set({
          replyStatus: "unknown",
          replyAttemptStartedAt: null,
        })
        .where(
          and(
            eq(menaMetaInboxItems.id, itemId),
            eq(menaMetaInboxItems.workspaceId, workspaceId),
            eq(menaMetaInboxItems.replyStatus, "sending"),
          ),
        );
      return "unknown";
    }

    const [reserved] = await transaction
      .update(menaMetaInboxItems)
      .set({
        replyStatus: "sending",
        replyAttemptStartedAt: now,
      })
      .where(
        and(
          eq(menaMetaInboxItems.id, itemId),
          eq(menaMetaInboxItems.workspaceId, workspaceId),
          isNull(menaMetaInboxItems.replyText),
          isNull(menaMetaInboxItems.replyStatus),
        ),
      )
      .returning({ id: menaMetaInboxItems.id });
    return reserved ? "reserved" : "in_progress";
  });
}

export async function releaseMetaInboxReplyReservation(
  workspaceId: string,
  itemId: string,
  status: "available" | "unknown",
): Promise<void> {
  await db
    .update(menaMetaInboxItems)
    .set({
      replyStatus: status === "unknown" ? "unknown" : null,
      replyAttemptStartedAt: null,
    })
    .where(
      and(
        eq(menaMetaInboxItems.id, itemId),
        eq(menaMetaInboxItems.workspaceId, workspaceId),
        eq(menaMetaInboxItems.replyStatus, "sending"),
      ),
    );
}

export async function completeMetaInboxReply(
  workspaceId: string,
  itemId: string,
  input: {
    text: string;
    externalId: string | null;
    repliedAt: Date;
  },
): Promise<boolean> {
  const [updated] = await db
    .update(menaMetaInboxItems)
    .set({
      replyText: input.text,
      replyExternalId: input.externalId,
      repliedAt: input.repliedAt,
      replyStatus: null,
      replyAttemptStartedAt: null,
    })
    .where(
      and(
        eq(menaMetaInboxItems.id, itemId),
        eq(menaMetaInboxItems.workspaceId, workspaceId),
        eq(menaMetaInboxItems.replyStatus, "sending"),
        isNull(menaMetaInboxItems.replyText),
      ),
    )
    .returning({ id: menaMetaInboxItems.id });
  return Boolean(updated);
}

export async function confirmMetaInboxReplyNotSent(
  workspaceId: string,
  itemId: string,
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(menaMetaInboxItems)
      .set({
        replyStatus: null,
        replyAttemptStartedAt: null,
      })
      .where(
        and(
          eq(menaMetaInboxItems.id, itemId),
          eq(menaMetaInboxItems.workspaceId, workspaceId),
          eq(menaMetaInboxItems.replyStatus, "unknown"),
          isNull(menaMetaInboxItems.replyText),
        ),
      )
      .returning({ id: menaMetaInboxItems.id });
    if (!updated) return false;

    await transaction
      .update(menaMetaAutoReplyJobs)
      .set({
        status: "skipped",
        errorCode: "MANUAL_RETRY_CONFIRMED",
        leaseExpiresAt: null,
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
          eq(menaMetaAutoReplyJobs.inboxItemId, itemId),
          eq(menaMetaAutoReplyJobs.status, "unknown"),
        ),
      );
    return true;
  });
}
