import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { processWhatsAppMarketingQueue } from "./lib/whatsapp-marketing";
import {
  processWhatsAppMediaDownloadQueue,
  processWhatsAppMediaThumbnailQueue,
} from "./lib/whatsapp-media-download";
import { processMetaAutoReplyQueue } from "./lib/meta-auto-reply-worker";
import { processWhatsAppProductExtractionQueue } from "./lib/whatsapp-product-extraction";
import { processProductPublicationQueue } from "./lib/product-publishing";
import { processMetaWebhookSubscriptionQueue } from "./lib/meta-webhook-subscriptions";
import { markStaleWhatsAppAutoRepliesUnknown } from "./lib/whatsapp-auto-reply-recovery";

type WorkerName =
  | "auto-reply-recovery"
  | "meta-webhook-subscriptions"
  | "product-extraction"
  | "product-publication"
  | "media-download"
  | "meta-auto-replies"
  | "media-thumbnails"
  | "whatsapp-marketing";

type Worker = {
  name: WorkerName;
  intervalMs: number;
  enabled: () => boolean;
  run: () => Promise<unknown>;
  disabledMessage: string;
  errorMessage: string;
};

const workers: Worker[] = [
  {
    name: "auto-reply-recovery",
    intervalMs: 60_000,
    enabled: () => true,
    run: markStaleWhatsAppAutoRepliesUnknown,
    disabledMessage: "",
    errorMessage: "Stale WhatsApp auto-reply reconciliation failed",
  },
  {
    name: "meta-webhook-subscriptions",
    intervalMs: 60_000,
    enabled: () => Boolean(process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim()),
    run: processMetaWebhookSubscriptionQueue,
    disabledMessage:
      "Meta webhook subscription reconciliation disabled because the verification token is not configured",
    errorMessage: "Meta webhook subscription reconciliation failed",
  },
  {
    name: "product-extraction",
    intervalMs: 3_000,
    enabled: () =>
      process.env.WHATSAPP_PRODUCT_EXTRACTION_WORKER_ENABLED !== "false",
    run: processWhatsAppProductExtractionQueue,
    disabledMessage: "WhatsApp product extraction worker disabled",
    errorMessage: "WhatsApp product extraction queue poll failed",
  },
  {
    name: "product-publication",
    intervalMs: 3_000,
    enabled: () => process.env.PRODUCT_PUBLICATION_WORKER_ENABLED !== "false",
    run: processProductPublicationQueue,
    disabledMessage: "Product publication worker disabled",
    errorMessage: "Product publication queue poll failed",
  },
  {
    name: "media-download",
    intervalMs: 3_000,
    enabled: () =>
      process.env.WHATSAPP_MEDIA_DOWNLOAD_WORKER_ENABLED !== "false",
    run: processWhatsAppMediaDownloadQueue,
    disabledMessage: "WhatsApp media download worker disabled",
    errorMessage: "WhatsApp media download queue poll failed",
  },
  {
    name: "meta-auto-replies",
    intervalMs: 3_000,
    enabled: () => process.env.META_AUTO_REPLY_WORKER_ENABLED !== "false",
    run: processMetaAutoReplyQueue,
    disabledMessage: "Meta auto-reply worker disabled",
    errorMessage: "Meta auto-reply worker poll failed",
  },
  {
    name: "media-thumbnails",
    intervalMs: 5_000,
    enabled: () =>
      process.env.WHATSAPP_MEDIA_THUMBNAIL_WORKER_ENABLED !== "false",
    run: processWhatsAppMediaThumbnailQueue,
    disabledMessage: "WhatsApp thumbnail worker disabled",
    errorMessage: "WhatsApp thumbnail worker poll failed",
  },
  {
    name: "whatsapp-marketing",
    intervalMs: 3_000,
    enabled: () => process.env.WHATSAPP_MARKETING_WORKER_ENABLED === "true",
    run: processWhatsAppMarketingQueue,
    disabledMessage:
      "WhatsApp content queue worker disabled; use manual conversion from message groups",
    errorMessage: "WhatsApp content queue poll failed",
  },
];

const selectedName = process.env.MENA_WORKER_NAME?.trim() || "all";
if (
  selectedName !== "all" &&
  !workers.some((worker) => worker.name === selectedName)
) {
  throw new Error(`Unknown MENA_WORKER_NAME: ${selectedName}`);
}

const selectedWorkers =
  selectedName === "all"
    ? workers
    : workers.filter((worker) => worker.name === selectedName);
const timers: NodeJS.Timeout[] = [];
const activeRuns = new Set<Promise<unknown>>();
let stopping = false;

for (const worker of selectedWorkers) {
  if (!worker.enabled()) {
    if (worker.disabledMessage) logger.info(worker.disabledMessage);
    continue;
  }

  let running = false;
  const run = () => {
    if (running || stopping) return;
    running = true;
    const activeRun = Promise.resolve()
      .then(worker.run)
      .catch((error: unknown) => {
        logger.error({ err: error, worker: worker.name }, worker.errorMessage);
      })
      .finally(() => {
        running = false;
        activeRuns.delete(activeRun);
      });
    activeRuns.add(activeRun);
  };

  logger.info({ worker: worker.name }, "Background worker started");
  run();
  const timer = setInterval(run, worker.intervalMs);
  timer.unref();
  timers.push(timer);
}

async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  for (const timer of timers) clearInterval(timer);
  await Promise.allSettled([...activeRuns]);
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
