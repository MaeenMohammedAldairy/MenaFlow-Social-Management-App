import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { runAppWorkersOnce, startAppWorkerLoops } from "./lib/app-workers";
import { workerTickBudgetMs } from "./lib/worker-tick-policy";

const selectedName = process.env.MENA_WORKER_NAME?.trim() || "all";
const tickOnly = process.env.MENA_WORKER_RUN_ONCE === "true";

/**
 * `MENA_WORKER_RUN_ONCE=true` runs one pass and exits, for anything that owns a
 * schedule but not a process: Vercel Cron pointed at a small service, a container
 * `sleep`-less entrypoint, a scheduled GitHub Action, `systemd`'s
 * `Type=oneshot`. It shares the worker list with the loops — see
 * `runAppWorkersOnce` — so a queue registered once is driven both ways.
 *
 * The budget applies here too; a worker service that always wants every queue
 * sets `MENA_WORKER_TICK_BUDGET_MS=0`.
 */
async function runOnceAndExit(): Promise<void> {
  const started = Date.now();
  const result = await runAppWorkersOnce({
    only: selectedName === "all" ? null : [selectedName],
    budgetMs: workerTickBudgetMs(),
  });
  logger.info(
    {
      ran: result.ran,
      failed: result.failed,
      busy: result.busy,
      deferred: result.deferred,
      disabled: result.disabled,
      durationMs: Date.now() - started,
    },
    "MENA_WORKER_RUN_ONCE pass finished",
  );
  await pool.end();
  process.exit(result.failed.length > 0 ? 1 : 0);
}

if (tickOnly) {
  void runOnceAndExit().catch(async (error: unknown) => {
    logger.error({ err: error }, "MENA_WORKER_RUN_ONCE pass failed");
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
} else {
const workerLoops = startAppWorkerLoops(selectedName);

async function shutdown(): Promise<void> {
  await workerLoops.stop();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown().catch((error: unknown) => {
    logger.error({ err: error }, "Worker shutdown failed");
    process.exitCode = 1;
  });
});
process.once("SIGTERM", () => {
  void shutdown().catch((error: unknown) => {
    logger.error({ err: error }, "Worker shutdown failed");
    process.exitCode = 1;
  });
});
}
