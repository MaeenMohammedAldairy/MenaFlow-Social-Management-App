/**
 * Run control for long WhatsApp sync work: how many groups may sync at once,
 * how long one run may keep fetching, and how often a live run has to prove it
 * is still alive.
 *
 * These are the three knobs that decide whether a sync degrades gracefully. A
 * merchant with forty selected groups used to start forty parallel history
 * scans; a scan that never hit its page cap could keep fetching for hours; and
 * while it fetched, nothing touched `mena_whatsapp_sync_states.updated_at`, so
 * a second process — the API cancelling stale runs while a worker performs them
 * — saw a live run as abandoned after ten minutes and cancelled it.
 *
 * Pure on purpose: no database, no timers of its own, an injectable clock, so
 * the scheduling behaviour is testable without a sync ever running.
 */

export const DEFAULT_SYNC_GROUP_CONCURRENCY = 3;
export const DEFAULT_SYNC_RUN_BUDGET_MS = 10 * 60_000;
export const DEFAULT_SYNC_HEARTBEAT_MS = 60_000;

const MIN_SYNC_GROUP_CONCURRENCY = 1;
const MAX_SYNC_GROUP_CONCURRENCY = 16;
const MIN_SYNC_RUN_BUDGET_MS = 30_000;
const MIN_SYNC_HEARTBEAT_MS = 5_000;

/**
 * Reads a positive integer setting. Unparseable or non-positive input falls
 * back to the default; a value that is merely too small or too large is clamped
 * to the safe range instead of being ignored, so an operator who asks for a
 * short budget gets a short budget and not a silently different one.
 */
function positiveInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

/** Groups synced in parallel. Bounded above so a typo cannot flood Evolution. */
export function resolveSyncGroupConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveInteger(
    env.WHATSAPP_SYNC_GROUP_CONCURRENCY,
    DEFAULT_SYNC_GROUP_CONCURRENCY,
    MIN_SYNC_GROUP_CONCURRENCY,
    MAX_SYNC_GROUP_CONCURRENCY,
  );
}

/** Wall-clock budget for the fetch phase of one group sync. */
export function resolveSyncRunBudgetMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveInteger(
    env.WHATSAPP_SYNC_RUN_BUDGET_MS,
    DEFAULT_SYNC_RUN_BUDGET_MS,
    MIN_SYNC_RUN_BUDGET_MS,
  );
}

/** How often a running sync refreshes `updated_at` to prove it is alive. */
export function resolveSyncHeartbeatMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveInteger(
    env.WHATSAPP_SYNC_HEARTBEAT_MS,
    DEFAULT_SYNC_HEARTBEAT_MS,
    MIN_SYNC_HEARTBEAT_MS,
  );
}

export type RunDeadline = {
  /** True once the budget is used up. */
  expired(): boolean;
  remainingMs(): number;
  elapsedMs(): number;
};

/**
 * A wall-clock budget. Expired work stops *cooperatively*: the caller checks
 * between units of work and keeps whatever it already collected, so hitting the
 * budget costs the rest of this run rather than the run's results.
 */
export function createRunDeadline(
  budgetMs: number,
  now: () => number = Date.now,
): RunDeadline {
  const budget = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 0;
  const startedAt = now();
  return {
    elapsedMs: () => now() - startedAt,
    remainingMs: () => Math.max(0, budget - (now() - startedAt)),
    expired: () => budget > 0 && now() - startedAt >= budget,
  };
}

export type Heartbeat = {
  /** True when at least `intervalMs` passed since the last beat. */
  due(): boolean;
  /** Records a beat; the caller performs the write. */
  beat(): void;
  lastBeatAt(): number;
};

/**
 * Throttles a liveness write. The first check after `intervalMs` is due, so a
 * caller in a tight loop writes once per interval instead of once per unit.
 */
export function createHeartbeat(
  intervalMs: number,
  now: () => number = Date.now,
): Heartbeat {
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 0;
  let lastBeat = now();
  return {
    due: () => interval > 0 && now() - lastBeat >= interval,
    beat: () => {
      lastBeat = now();
    },
    lastBeatAt: () => lastBeat,
  };
}

/**
 * Maps items with at most `limit` tasks in flight, preserving input order.
 *
 * The first failure stops new work from starting — tasks already running are
 * awaited so nothing is abandoned mid-write — and then rejects with that error.
 * A `limit` below 1 is treated as 1, and a limit above the item count never
 * spawns idle workers.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const workers = Math.max(
    1,
    Math.min(
      Math.floor(Number.isFinite(limit) ? limit : 1),
      items.length,
    ),
  );
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown = null;

  const runWorker = async (): Promise<void> => {
    for (;;) {
      if (failed) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await task(items[index]!, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        return;
      }
    }
  };

  await Promise.all(
    Array.from({ length: workers }, () => runWorker()),
  );
  if (failed) throw failure;
  return results;
}
