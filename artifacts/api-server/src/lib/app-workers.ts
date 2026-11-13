import { logger } from "./logger";
import {
  startBackgroundWorkerLoop,
  type BackgroundWorkerLoopHandle,
} from "./background-worker-loop";
import { processWhatsAppMarketingQueue } from "./whatsapp-marketing";
import {
  processWhatsAppMediaDownloadQueue,
  processWhatsAppMediaThumbnailQueue,
} from "./whatsapp-media-download";
import { processWhatsAppProductExtractionQueue } from "./whatsapp-product-extraction";
import { processWhatsAppAutoReplyQueue } from "./whatsapp-sync";
import { processWhatsAppOrderConfirmationsQueue } from "./whatsapp-order-confirmation-queue";
import { processProductPublicationQueue } from "./product-publishing";
import { processMetaWebhookSubscriptionQueue } from "./meta-webhook-subscriptions";
import { markStaleWhatsAppAutoRepliesUnknown } from "./whatsapp-auto-reply-recovery";
import { purgeExpiredWhatsAppDirectMessages } from "./whatsapp-direct-message-retention";

type WorkerName =
  | "auto-reply-recovery"
  | "whatsapp-auto-replies"
  | "whatsapp-order-confirmations"
  | "whatsapp-direct-message-retention"
  | "meta-webhook-subscriptions"
  | "product-extraction"
  | "product-publication"
  | "media-download"
  | "media-thumbnails"
  | "whatsapp-marketing";

type WorkerDefinition = {
  name: WorkerName;
  intervalMs: number;
  enabled: () => boolean;
  run: () => Promise<unknown>;
  disabledMessage: string;
  errorMessage: string;
};

export type AppWorkerLoops = {
  stop: () => Promise<void>;
};

const workers: WorkerDefinition[] = [
  {
    name: "auto-reply-recovery",
    intervalMs: 60_000,
    enabled: () => true,
    run: markStaleWhatsAppAutoRepliesUnknown,
    disabledMessage: "",
    errorMessage: "Stale WhatsApp auto-reply reconciliation failed",
  },
  {
    name: "whatsapp-direct-message-retention",
    intervalMs: 60_000,
    enabled: () => true,
    run: purgeExpiredWhatsAppDirectMessages,
    disabledMessage: "",
    errorMessage: "WhatsApp direct-message retention cleanup failed",
  },
  {
    name: "whatsapp-auto-replies",
    intervalMs: 1_000,
    enabled: () => process.env.WHATSAPP_AUTO_REPLY_WORKER_ENABLED !== "false",
    run: processWhatsAppAutoReplyQueue,
    disabledMessage: "WhatsApp automatic reply worker disabled",
    errorMessage: "WhatsApp automatic reply queue poll failed",
  },
  {
    name: "whatsapp-order-confirmations",
    intervalMs: 1_000,
    enabled: () => true,
    run: processWhatsAppOrderConfirmationsQueue,
    disabledMessage: "",
    errorMessage: "WhatsApp order confirmation queue poll failed",
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

export function startAppWorkerLoops(
  selectedName = "all",
  options: { excludeInlineMediaDownload?: boolean } = {},
): AppWorkerLoops {
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
  const handles: BackgroundWorkerLoopHandle[] = [];

  for (const worker of selectedWorkers) {
    if (
      options.excludeInlineMediaDownload &&
      worker.name === "media-download" &&
      process.env.WHATSAPP_MEDIA_DOWNLOAD_INLINE_WORKER_ENABLED === "true"
    ) {
      continue;
    }

    if (!worker.enabled()) {
      if (worker.disabledMessage) logger.info(worker.disabledMessage);
      continue;
    }

    logger.info({ worker: worker.name }, "Background worker started");
    handles.push(
      startBackgroundWorkerLoop(
        worker.name,
        async () => {
          await worker.run();
          return 0;
        },
        (error) => {
          logger.error({ err: error, worker: worker.name }, worker.errorMessage);
        },
        worker.intervalMs,
        false,
      ),
    );
  }

  return {
    async stop() {
      await Promise.all(handles.map((handle) => handle.stop()));
    },
  };
}