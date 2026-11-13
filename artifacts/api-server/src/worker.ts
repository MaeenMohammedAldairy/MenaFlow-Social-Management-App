import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startAppWorkerLoops } from "./lib/app-workers";

const selectedName = process.env.MENA_WORKER_NAME?.trim() || "all";
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
