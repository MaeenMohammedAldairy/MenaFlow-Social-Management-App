import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { runAppWorkersOnce } from "../lib/app-workers";
import {
  decideWorkerTickAccess,
  parseWorkerTickWorkers,
  workerTickBudgetMs,
} from "../lib/worker-tick-policy";

/**
 * `POST /api/internal/worker-tick` — run one pass over the background queues.
 *
 * Every queue in this product (media downloads, product extraction, publication,
 * auto-replies, push) is normally driven by a `setInterval` inside the API
 * process. On a serverless deployment that timer only advances while an instance
 * is warm, so work that is *due* stays undone until a customer opens the app: on
 * 2026-11-27 that was four media rows past `next_attempt_at` and thirteen
 * extraction jobs past `next_run_at`. A scheduler needs a door to knock on, and
 * this is that door: the same worker list, one pass, then an answer.
 *
 * The access rules are in `worker-tick-policy.ts` and are checked before anything
 * else — including before any queue is touched — because with no secret
 * configured the route must not run at all. The response is deliberately the pass
 * result and nothing else: it never reads or writes a workspace's records in a
 * way the caller could learn from, so a scheduler can be given the secret without
 * giving it the data.
 *
 * Mounted with the health probes, ahead of the session middleware: a cron has no
 * session, and the secret is the credential.
 */
const router: IRouter = Router();

router.post("/internal/worker-tick", async (req, res) => {
  const access = decideWorkerTickAccess({
    authorization: req.header("authorization") ?? null,
  });
  if (!access.allowed) {
    logger.warn(
      { code: access.code, path: req.path },
      "WhatsApp worker tick refused",
    );
    res
      .status(access.status)
      .json({ error: "تعذّر تنفيذ دورة العمال.", code: access.code });
    return;
  }

  const budgetMs = workerTickBudgetMs();
  try {
    const result = await runAppWorkersOnce({
      only: parseWorkerTickWorkers(
        typeof req.query?.workers === "string" ? req.query.workers : null,
      ),
      budgetMs,
    });
    if (result.failed.length > 0) {
      logger.error(
        { failed: result.failed, ran: result.ran.length },
        "Background worker pass reported failures",
      );
    }
    res.json({ ...result, budgetMs });
  } catch (error) {
    logger.error({ err: error }, "Background worker pass failed to run");
    res
      .status(500)
      .json({ error: "تعذّر تنفيذ دورة العمال.", code: "WORKER_TICK_FAILED" });
  }
});

export default router;
