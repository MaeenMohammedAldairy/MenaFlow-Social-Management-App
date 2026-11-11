import { randomUUID, timingSafeEqual } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  whatsappCloudMessagingAccounts,
  whatsappCloudWebhookEvents,
} from "@workspace/db";
import { metaString } from "../lib/meta-inbox-utils";
import {
  parseWhatsAppCloudWebhookEvents,
  verifyWhatsAppCloudWebhookSignature,
} from "../lib/whatsapp-cloud-webhook";

const router = Router();

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

router.get("/social/whatsapp-cloud/webhook", (req, res) => {
  const verifyToken = process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim();
  const mode = metaString(req.query["hub.mode"]);
  const token = metaString(req.query["hub.verify_token"]);
  const challenge = metaString(req.query["hub.challenge"]);

  if (!verifyToken) {
    res.status(503).send("Webhook verification token is not configured.");
    return;
  }
  if (
    mode !== "subscribe" ||
    !token ||
    !challenge ||
    !constantTimeEqual(token, verifyToken)
  ) {
    res.status(403).send("Webhook verification failed.");
    return;
  }
  res.status(200).type("text/plain").send(challenge);
});

router.post("/social/whatsapp-cloud/webhook", async (req, res, next) => {
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appSecret) {
    res.status(503).json({
      error: "إعداد سر تطبيق Meta غير متاح على الخادم.",
      code: "META_CONFIGURATION_MISSING",
    });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (!rawBody) {
    res.status(415).json({
      error: "يجب إرسال حدث WhatsApp Cloud بصيغة JSON.",
      code: "INVALID_WEBHOOK_CONTENT_TYPE",
    });
    return;
  }
  if (
    !verifyWhatsAppCloudWebhookSignature(
      rawBody,
      req.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    res.status(401).json({
      error: "توقيع WhatsApp Cloud webhook غير صالح.",
      code: "INVALID_WEBHOOK_SIGNATURE",
    });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({
      error: "صيغة حدث WhatsApp Cloud غير صالحة.",
      code: "INVALID_WEBHOOK_PAYLOAD",
    });
    return;
  }

  if (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    (payload as Record<string, unknown>).object !==
      "whatsapp_business_account"
  ) {
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  const events = parseWhatsAppCloudWebhookEvents(payload);
  if (!events) {
    res.status(400).json({
      error: "صيغة حدث WhatsApp Cloud غير صالحة.",
      code: "INVALID_WEBHOOK_PAYLOAD",
    });
    return;
  }
  if (events.length === 0) {
    res.status(200).json({ received: true, persisted: 0, duplicates: 0 });
    return;
  }

  try {
    const messagingAccountIds = [
      ...new Set(events.map((event) => event.metaMessagingAccountId)),
    ];
    const accounts = await db
      .select({
        id: whatsappCloudMessagingAccounts.id,
        workspaceId: whatsappCloudMessagingAccounts.workspaceId,
        connectionId: whatsappCloudMessagingAccounts.connectionId,
        metaMessagingAccountId:
          whatsappCloudMessagingAccounts.metaMessagingAccountId,
      })
      .from(whatsappCloudMessagingAccounts)
      .where(
        inArray(
          whatsappCloudMessagingAccounts.metaMessagingAccountId,
          messagingAccountIds,
        ),
      );
    const accountsByMetaId = new Map<
      string,
      (typeof accounts)[number][]
    >();
    for (const account of accounts) {
      const candidates =
        accountsByMetaId.get(account.metaMessagingAccountId) ?? [];
      candidates.push(account);
      accountsByMetaId.set(account.metaMessagingAccountId, candidates);
    }

    const receivedAt = new Date();
    const inserted = await db
      .insert(whatsappCloudWebhookEvents)
      .values(
        events.map((event) => {
          const candidates =
            accountsByMetaId.get(event.metaMessagingAccountId) ?? [];
          const account = candidates.length === 1 ? candidates[0] : null;
          return {
            id: randomUUID(),
            eventKey: event.eventKey,
            workspaceId: account?.workspaceId ?? null,
            connectionId: account?.connectionId ?? null,
            metaMessagingAccountId: event.metaMessagingAccountId,
            eventType: event.eventType,
            payload: event.payload,
            status: account ? "received" : "unmatched",
            lastErrorCode: account
              ? null
              : candidates.length > 1
                ? "AMBIGUOUS_MESSAGING_ACCOUNT"
                : "MESSAGING_ACCOUNT_NOT_LINKED",
            receivedAt,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: whatsappCloudWebhookEvents.id });

    res.status(200).json({
      received: true,
      persisted: inserted.length,
      duplicates: events.length - inserted.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
