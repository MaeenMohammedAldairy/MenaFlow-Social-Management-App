import { pool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { processWhatsAppCloudWebhookQueue } from "./lib/whatsapp-cloud-webhook-worker";
import { startWhatsAppCloudWorkerLoop } from "./lib/whatsapp-cloud-worker-loop";

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

let startWorkerHandle: ReturnType<typeof startWhatsAppCloudWorkerLoop> | null =
  null;
let shutdownPromise: Promise<void> | null = null;

const server = app.listen(port, "0.0.0.0", (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ host: "0.0.0.0", port }, "Server listening");
  if (
    process.env.WHATSAPP_CLOUD_INLINE_WORKER_ENABLED === "true" &&
    process.env.WHATSAPP_CLOUD_WEBHOOK_WORKER_ENABLED !== "false"
  ) {
    startWorkerHandle = startWhatsAppCloudWorkerLoop(
      processWhatsAppCloudWebhookQueue,
      (error) => {
        logger.error(
          { err: error },
          "WhatsApp Cloud inline webhook worker poll failed",
        );
      },
    );
    logger.info("WhatsApp Cloud inline webhook worker started");
  } else {
    logger.info("WhatsApp Cloud inline webhook worker disabled");
  }
});

function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  logger.info({ signal }, "API server graceful shutdown started");
  shutdownPromise = (async () => {
    const workerStopped = startWorkerHandle?.stop() ?? Promise.resolve();
    const serverClosed = new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await Promise.all([workerStopped, serverClosed]);
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
