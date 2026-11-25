import { and, eq, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { db, menaOrders } from "@workspace/db";
import {
  confirmationAttemptsExhausted,
  ORDER_CONFIRMATION_MAX_ATTEMPTS,
} from "./order-confirmation-policy";

/**
 * The lease-and-claim mechanics the two order-confirmation queues run on.
 *
 * Each queue used to carry its own copy of the same three statements over
 * `mena_orders`: sweeping rows whose worker died while `sending` (or whose
 * retries ran out) to a terminal status, claiming the next due row under a
 * lease with `FOR UPDATE SKIP LOCKED`, and looping claim → process. They are
 * written once here and parametrised by a queue description; the two queues
 * (`whatsapp-order-confirmation-queue.ts`, `meta-order-confirmation-queue.ts`)
 * keep what genuinely differs:
 *
 *  - **policy** — lease length, the terminal status for an exhausted row
 *    (WhatsApp asks for a manual follow-up, Meta records a failure), which
 *    stale rows are swept before each claim, and the order due rows are taken
 *    in (`next_run_at` for WhatsApp, `created_at` for Meta, whose `next_run_at`
 *    is a rate-limit backoff rather than a schedule);
 *  - **the column family** — Drizzle's `set()` takes literal property names, so
 *    each queue writes its own patches with those names; this module decides
 *    *when* and *under what condition* they apply;
 *  - **the send itself** — Meta has a 24-hour reply window, permission and
 *    rate-limit handling; WhatsApp resolves an encrypted source address that
 *    can expire. Each queue keeps its pre-send checks, provider call and error
 *    mapping, and writes its own non-terminal statuses.
 */

type OrderRow = typeof menaOrders.$inferSelect;
type OrderInsert = typeof menaOrders.$inferInsert;
/** What `update(menaOrders).set()` accepts: any column, or SQL for it (the attempt increment). */
type OrderPatch = { [K in keyof OrderInsert]?: OrderInsert[K] | SQL };

/** The columns the shared `where` / `order by` clauses address. */
export type OrderConfirmationColumns = {
  status:
    | typeof menaOrders.whatsappConfirmationStatus
    | typeof menaOrders.metaConfirmationStatus;
  attempts:
    | typeof menaOrders.whatsappConfirmationAttempts
    | typeof menaOrders.metaConfirmationAttempts;
  leaseExpiresAt:
    | typeof menaOrders.whatsappConfirmationLeaseExpiresAt
    | typeof menaOrders.metaConfirmationLeaseExpiresAt;
  nextRunAt:
    | typeof menaOrders.whatsappConfirmationNextRunAt
    | typeof menaOrders.metaConfirmationNextRunAt;
};

/**
 * The writes, with each family's literal property names.
 * `exhausted` and `claim` both clear or set the lease; `sweep` is the
 * "the worker that held this row is gone" write.
 */
export type OrderConfirmationPatches = {
  sweep: (to: "unknown" | "failed", error: string, now: Date) => OrderPatch;
  exhausted: (now: Date) => OrderPatch;
  claim: (leaseExpiresAt: Date, now: Date) => OrderPatch;
};

/** A stale row: still `from` although the lease it was held under has expired. */
export type OrderConfirmationSweep = {
  from: "sending" | "processing";
  to: "unknown" | "failed";
  error: string;
  /** Only rows whose attempts have reached the ceiling. */
  exhaustedOnly?: boolean;
};

export type OrderConfirmationQueue = {
  columns: OrderConfirmationColumns;
  patches: OrderConfirmationPatches;
  leaseMs: number;
  orderBy: SQL;
  /** Run before every claim, in order, outside the claim transaction. */
  staleSweeps?: readonly OrderConfirmationSweep[];
  process: (order: OrderRow) => Promise<void>;
};

async function sweepStaleConfirmations(
  queue: OrderConfirmationQueue,
  now: Date,
  sweep: OrderConfirmationSweep,
): Promise<void> {
  const { status, leaseExpiresAt, attempts } = queue.columns;
  const conditions: SQL[] = [eq(status, sweep.from), lt(leaseExpiresAt, now)];
  if (sweep.exhaustedOnly) {
    conditions.push(sql`${attempts} >= ${ORDER_CONFIRMATION_MAX_ATTEMPTS}`);
  }
  await db
    .update(menaOrders)
    .set(queue.patches.sweep(sweep.to, sweep.error, now))
    .where(and(...conditions));
}

/**
 * The next due order, moved to `processing` under a fresh lease — or null when
 * nothing is due. A candidate whose attempts are spent is ended in place and
 * not returned, so a retry that can no longer happen never blocks the queue.
 *
 * The candidate is locked (`SKIP LOCKED`), so two workers polling at once each
 * take a different row; a row locked by a worker that died is picked up again
 * once its lease expires.
 */
export async function claimNextOrderConfirmation(
  queue: OrderConfirmationQueue,
  now = new Date(),
): Promise<OrderRow | null> {
  for (const sweep of queue.staleSweeps ?? []) {
    await sweepStaleConfirmations(queue, now, sweep);
  }
  const { status, attempts, leaseExpiresAt, nextRunAt } = queue.columns;
  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select({ id: menaOrders.id, attempts })
      .from(menaOrders)
      .where(
        or(
          and(eq(status, "queued"), lte(nextRunAt, now)),
          and(eq(status, "processing"), lt(leaseExpiresAt, now)),
        ),
      )
      .orderBy(queue.orderBy)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    if (confirmationAttemptsExhausted(candidate.attempts)) {
      await transaction
        .update(menaOrders)
        .set(queue.patches.exhausted(now))
        .where(eq(menaOrders.id, candidate.id));
      return null;
    }
    const [claimed] = await transaction
      .update(menaOrders)
      .set(queue.patches.claim(new Date(now.getTime() + queue.leaseMs), now))
      .where(eq(menaOrders.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

/**
 * Claims and processes up to `limit` orders. With `onError`, a failure on one
 * order is reported and the loop moves to the next; without it, the failure
 * propagates to the worker loop, which logs it and waits for the next tick.
 */
export async function runOrderConfirmationQueue(
  queue: OrderConfirmationQueue,
  options: {
    limit?: number;
    onError?: (error: unknown, order: OrderRow) => void;
  } = {},
): Promise<number> {
  let processed = 0;
  for (let count = 0; count < (options.limit ?? 5); count += 1) {
    const order = await claimNextOrderConfirmation(queue);
    if (!order) break;
    if (options.onError) {
      try {
        await queue.process(order);
      } catch (error) {
        options.onError(error, order);
      }
    } else {
      await queue.process(order);
    }
    processed += 1;
  }
  return processed;
}
