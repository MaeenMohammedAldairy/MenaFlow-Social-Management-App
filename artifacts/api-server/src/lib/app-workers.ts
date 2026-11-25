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
import {
  autoQueueWhatsAppProductExtractions,
  processWhatsAppProductExtractionQueue,
  relinkCompletedExtractionMedia,
} from "./whatsapp-product-extraction";
import { processWhatsAppAutoReplyQueue } from "./whatsapp-sync";
import { processWhatsAppOrderConfirmationsQueue } from "./whatsapp-order-confirmation-queue";
import { processProductPublicationQueue } from "./product-publishing";
import { processMetaWebhookSubscriptionQueue } from "./meta-webhook-subscriptions";
import { processMetaAutoReplyQueue } from "./meta-auto-reply-worker";
import { processMetaOrderConfirmationsQueue } from "./meta-order-confirmation-queue";
import { markStaleWhatsAppAutoRepliesUnknown } from "./whatsapp-auto-reply-recovery";
import { purgeExpiredWhatsAppDirectMessages } from "./whatsapp-direct-message-retention";
import { purgeOldInboundWebhookEvents } from "./inbound-delivery-log";
import { processScheduledPostsQueue } from "./scheduled-posts";
import { processWorkspaceDeletionQueue } from "./workspace-deletion";
import {
  isPushDeliveryConfigured,
  processPushNotificationQueue,
  purgeSettledPushNotifications,
} from "./push-notifications";

type WorkerName =
  | "scheduled-posts"
  | "workspace-deletion"
  | "auto-reply-recovery"
  | "meta-auto-replies"
  | "meta-order-confirmations"
  | "whatsapp-auto-replies"
  | "whatsapp-order-confirmations"
  | "whatsapp-direct-message-retention"
  | "inbound-webhook-retention"
  | "meta-webhook-subscriptions"
  | "product-extraction"
  | "product-extraction-queue"
  | "product-extraction-media-relink"
  | "product-publication"
  | "media-download"
  | "media-thumbnails"
  | "push-notifications"
  | "push-notification-retention"
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
    // Due scheduled posts (§4.7). 15s keeps "publish at 10:00" honest to the
    // minute without Meta graph bursts; claiming uses SKIP LOCKED so several
    // instances can poll safely.
    name: "scheduled-posts",
    intervalMs: 15_000,
    enabled: () => process.env.SCHEDULED_POSTS_WORKER_ENABLED !== "false",
    run: processScheduledPostsQueue,
    disabledMessage: "Scheduled posts worker disabled",
    errorMessage: "Scheduled posts queue poll failed",
  },
  {
    // Requests past the 30-day grace period are erased (§3.4). Hourly polling
    // is plenty for a grace measured in weeks, and keeps a merchant's data
    // recoverable by support for the whole grace window.
    name: "workspace-deletion",
    intervalMs: 60 * 60 * 1000,
    enabled: () => process.env.WORKSPACE_DELETION_WORKER_ENABLED !== "false",
    run: processWorkspaceDeletionQueue,
    disabledMessage: "Workspace deletion worker disabled",
    errorMessage: "Workspace deletion queue poll failed",
  },
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
    // The inbound delivery log is a diagnostics table, not a record: one row per
    // webhook call would otherwise grow without bound. Hourly is far coarser
    // than the 7-day window it enforces, and it runs wherever workers run.
    name: "inbound-webhook-retention",
    intervalMs: 60 * 60_000,
    enabled: () => true,
    run: purgeOldInboundWebhookEvents,
    disabledMessage: "",
    errorMessage: "Inbound webhook event retention cleanup failed",
  },
  {
    // Meta replies used to run from an inline loop inside the API process only,
    // so a deployment that runs this worker separately never answered Facebook
    // or Instagram messages. Both entries now run wherever workers run.
    name: "meta-auto-replies",
    intervalMs: 3_000,
    enabled: () => process.env.META_AUTO_REPLY_WORKER_ENABLED !== "false",
    run: processMetaAutoReplyQueue,
    disabledMessage: "Meta automatic reply worker disabled",
    errorMessage: "Meta automatic reply queue poll failed",
  },
  {
    name: "meta-order-confirmations",
    intervalMs: 3_000,
    enabled: () => true,
    run: processMetaOrderConfirmationsQueue,
    disabledMessage: "",
    errorMessage: "Meta order confirmation queue poll failed",
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
    name: "product-extraction-media-relink",
    intervalMs: 60_000,
    enabled: () =>
      process.env.WHATSAPP_PRODUCT_EXTRACTION_WORKER_ENABLED !== "false",
    run: relinkCompletedExtractionMedia,
    disabledMessage: "Product extraction media relink worker disabled",
    errorMessage: "Product extraction media relink poll failed",
  },
  {
    // Selecting a WhatsApp group is the merchant's opt-in to extracting products
    // from it, so the queue is filled without anyone pressing a button. Runs
    // slower than the extraction worker it feeds: queueing is a scan, not a
    // deadline.
    name: "product-extraction-queue",
    intervalMs: 60_000,
    enabled: () =>
      process.env.WHATSAPP_PRODUCT_AUTOQUEUE_WORKER_ENABLED !== "false",
    run: autoQueueWhatsAppProductExtractions,
    disabledMessage: "WhatsApp product auto-queue worker disabled",
    errorMessage: "WhatsApp product auto-queue pass failed",
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
    // Push alerts are the only channel that reaches a merchant who is not
    // looking at the app, so this polls as often as the customer-facing queues.
    // Disabled without EXPO_PUSH_ACCESS_TOKEN: every send would fail, and
    // enqueueing is suppressed too, so nothing accumulates while it is off.
    name: "push-notifications",
    intervalMs: 3_000,
    enabled: () =>
      process.env.PUSH_NOTIFICATION_WORKER_ENABLED !== "false" &&
      isPushDeliveryConfigured(),
    run: processPushNotificationQueue,
    disabledMessage:
      "Push notification worker disabled because EXPO_PUSH_ACCESS_TOKEN is not configured",
    errorMessage: "Push notification queue poll failed",
  },
  {
    // Settled rows are kept only so a repeated dedupe bucket still collides;
    // purging them hourly is what keeps that constraint from growing forever.
    name: "push-notification-retention",
    intervalMs: 60 * 60 * 1000,
    enabled: () =>
      process.env.PUSH_NOTIFICATION_WORKER_ENABLED !== "false" &&
      isPushDeliveryConfigured(),
    run: purgeSettledPushNotifications,
    disabledMessage: "",
    errorMessage: "Push notification retention purge failed",
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