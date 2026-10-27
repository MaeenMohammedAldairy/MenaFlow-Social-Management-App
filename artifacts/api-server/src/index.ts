import app from "./app";
import { logger } from "./lib/logger";
import { processWhatsAppMarketingQueue } from "./lib/whatsapp-marketing";
import {
  processWhatsAppMediaDownloadQueue,
  processWhatsAppMediaThumbnailQueue,
} from "./lib/whatsapp-media-download";
import { processMetaAutoReplyQueue } from "./lib/meta-auto-reply-worker";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  if (process.env["WHATSAPP_MEDIA_DOWNLOAD_WORKER_ENABLED"] !== "false") {
    const mediaDownloadTimer = setInterval(() => {
      void processWhatsAppMediaDownloadQueue().catch((error) => {
        logger.error({ err: error }, "WhatsApp media download queue poll failed");
      });
    }, 3000);
    mediaDownloadTimer.unref();
    void processWhatsAppMediaDownloadQueue().catch((error) => {
      logger.error(
        { err: error },
        "Initial WhatsApp media download processing failed",
      );
    });
  } else {
    logger.info("WhatsApp media download worker disabled");
  }
  if (process.env["META_AUTO_REPLY_WORKER_ENABLED"] !== "false") {
    const metaAutoReplyTimer = setInterval(() => {
      void processMetaAutoReplyQueue().catch((error) => {
        logger.error({ err: error }, "Meta auto-reply worker poll failed");
      });
    }, 3000);
    metaAutoReplyTimer.unref();
    void processMetaAutoReplyQueue().catch((error) => {
      logger.error({ err: error }, "Initial Meta auto-reply processing failed");
    });
  } else {
    logger.info("Meta auto-reply worker disabled");
  }
  if (process.env["WHATSAPP_MEDIA_THUMBNAIL_WORKER_ENABLED"] !== "false") {
    const thumbnailTimer = setInterval(() => {
      void processWhatsAppMediaThumbnailQueue().catch((error) => {
        logger.error({ err: error }, "WhatsApp thumbnail worker poll failed");
      });
    }, 5000);
    thumbnailTimer.unref();
    void processWhatsAppMediaThumbnailQueue().catch((error) => {
      logger.error(
        { err: error },
        "Initial WhatsApp thumbnail processing failed",
      );
    });
  } else {
    logger.info("WhatsApp thumbnail worker disabled");
  }
  if (process.env["WHATSAPP_MARKETING_WORKER_ENABLED"] === "true") {
    const queueTimer = setInterval(() => {
      void processWhatsAppMarketingQueue().catch((error) => {
        logger.error({ err: error }, "WhatsApp content queue poll failed");
      });
    }, 3000);
    queueTimer.unref();
    void processWhatsAppMarketingQueue().catch((error) => {
      logger.error(
        { err: error },
        "Initial WhatsApp content queue processing failed",
      );
    });
  } else {
    logger.info("WhatsApp content queue worker disabled; use manual conversion from message groups");
  }
});
