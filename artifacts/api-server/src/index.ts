import { pool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import {
  startBackgroundWorkerLoop,
  type BackgroundWorkerLoopHandle,
} from "./lib/background-worker-loop";
import { processMetaAutoReplyQueue } from "./lib/meta-auto-reply-worker";
import { processWhatsAppMediaDownloadQueue } from "./lib/whatsapp-media-download";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

let mediaWorkerHandle: BackgroundWorkerLoopHandle | null = null;
let metaAutoReplyWorkerHandle: BackgroundWorkerLoopHandle | null = null;
let shutdownPromise: Promise<void> | null = null;

const server = app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host: "0.0.0.0", port }, "Server listening");
  if (process.env.META_AUTO_REPLY_WORKER_ENABLED !== "false") {
    metaAutoReplyWorkerHandle = startBackgroundWorkerLoop(
      "meta-auto-replies",
      async () => {
        await processMetaAutoReplyQueue();
        return 0;
      },
      (error) => {
        logger.error(
          { err: error },
          "Meta auto-reply inline worker poll failed",
        );
      },
      3_000,
      false,
    );
    logger.info("Meta auto-reply inline worker started");
  } else {
    logger.info("Meta auto-reply inline worker disabled");
  }

  if (
    process.env.WHATSAPP_MEDIA_DOWNLOAD_INLINE_WORKER_ENABLED === "true" &&
    process.env.WHATSAPP_MEDIA_DOWNLOAD_WORKER_ENABLED !== "false"
  ) {
    mediaWorkerHandle = startBackgroundWorkerLoop(
      "evolution-media-download",
      processWhatsAppMediaDownloadQueue,
      (error) => {
        logger.error(
          { err: error },
          "Evolution media inline worker poll failed",
        );
      },
      3_000,
      false,
    );
    logger.info("Evolution media inline worker started");
  } else {
    logger.info("Evolution media inline worker disabled");
  }
});

function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  logger.info({ signal }, "API server graceful shutdown started");
  shutdownPromise = (async () => {
    const workersStopped = Promise.all([
      mediaWorkerHandle?.stop() ?? Promise.resolve(),
      metaAutoReplyWorkerHandle?.stop() ?? Promise.resolve(),
    ]);
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await Promise.all([workersStopped, serverClosed]);
    await pool.end();
    logger.info({ signal }, "API server graceful shutdown completed");
  })();
  return shutdownPromise;
}

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").catch((error: unknown) => {
    logger.error({ err: error }, "API server shutdown failed");
    process.exitCode = 1;
  });
});
process.once("SIGINT", () => {
  void shutdown("SIGINT").catch((error: unknown) => {
    logger.error({ err: error }, "API server shutdown failed");
    process.exitCode = 1;
  });
});
