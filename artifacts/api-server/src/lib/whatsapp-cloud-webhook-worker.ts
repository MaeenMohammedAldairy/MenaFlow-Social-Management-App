import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import {
  whatsappCloudConversations,
  whatsappCloudMessagingAccountPhoneNumbers,
  whatsappCloudMessagingAccounts,
  whatsappCloudMessages,
  whatsappCloudPhoneNumbers,
  whatsappCloudWebhookEvents,
} from "@workspace/db";
import { logger } from "./logger";
import {
  parseWhatsAppCloudMessageChange,
  shouldAdvanceWhatsAppCloudMessageStatus,
  whatsappCloudMessagePreview,
  type WhatsAppCloudInboundMessage,
  type WhatsAppCloudMessageStatus,
} from "./whatsapp-cloud-message-parser";

const batchSize = 1;
const leaseMs = 60_000;
const maxAttempts = 5;
let workerRunning = false;

type JsonRecord = Record<string, unknown>;

type ClaimedWebhookEvent = {
  id: string;
  workspaceId: string | null;
  connectionId: string | null;
  metaMessagingAccountId: string;
  eventType: string;
  payload: JsonRecord | null;
  attempts: number;
};

class WhatsAppCloudWebhookProcessingError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string {
  return error instanceof WhatsAppCloudWebhookProcessingError
    ? error.code
    : "WHATSAPP_CLOUD_EVENT_PROCESSING_FAILED";
}

async function claimEvents(): Promise<ClaimedWebhookEvent[]> {
  await pool.query(
    `UPDATE public.mena_whatsapp_cloud_webhook_events
     SET status = 'failed',
         lease_expires_at = NULL,
         last_error_code = 'WHATSAPP_CLOUD_EVENT_ATTEMPTS_EXHAUSTED'
     WHERE status = 'processing'
       AND lease_expires_at <= now()
       AND attempts >= $1`,
    [maxAttempts],
  );
  const result = await pool.query<ClaimedWebhookEvent>(
    `WITH candidates AS (
       SELECT id
       FROM public.mena_whatsapp_cloud_webhook_events
       WHERE payload IS NOT NULL
         AND attempts < $1
         AND (
           (status = 'received' AND next_attempt_at <= now())
           OR (status = 'processing' AND lease_expires_at <= now())
         )
       ORDER BY received_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     UPDATE public.mena_whatsapp_cloud_webhook_events AS cloud_event
     SET status = 'processing',
         attempts = cloud_event.attempts + 1,
         lease_expires_at = now() + ($3::integer * interval '1 millisecond')
     FROM candidates
     WHERE cloud_event.id = candidates.id
     RETURNING cloud_event.id,
               cloud_event.workspace_id AS "workspaceId",
               cloud_event.connection_id AS "connectionId",
               cloud_event.meta_messaging_account_id AS "metaMessagingAccountId",
               cloud_event.event_type AS "eventType",
               cloud_event.payload,
               cloud_event.attempts`,
    [maxAttempts, batchSize, leaseMs],
  );
  return result.rows;
}

async function ensureConversation(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    workspaceId: string;
    environment: string;
    connectionId: string;
    messagingAccountId: string;
    phoneNumberId: string;
    customerWaId: string;
    customerName: string | null;
  },
): Promise<string> {
  const [conversation] = await transaction
    .insert(whatsappCloudConversations)
    .values({
      id: randomUUID(),
      ...input,
    })
    .onConflictDoUpdate({
      target: [
        whatsappCloudConversations.workspaceId,
        whatsappCloudConversations.environment,
        whatsappCloudConversations.phoneNumberId,
        whatsappCloudConversations.customerWaId,
      ],
      set: {
        customerName: input.customerName
          ? input.customerName
          : whatsappCloudConversations.customerName,
      },
    })
    .returning({ id: whatsappCloudConversations.id });
  if (!conversation) {
    throw new WhatsAppCloudWebhookProcessingError(
      "WHATSAPP_CLOUD_CONVERSATION_SAVE_FAILED",
    );
  }
  return conversation.id;
}

async function updateConversationForMessage(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    workspaceId: string;
    environment: string;
    conversationId: string;
    message: WhatsAppCloudInboundMessage;
    direction: "inbound" | "outbound";
    incrementUnread: boolean;
  },
): Promise<void> {
  const messageAt = input.message.messageAt;
  const preview = whatsappCloudMessagePreview(input.message);
  await transaction
    .update(whatsappCloudConversations)
    .set({
      lastMessageAt: sql`CASE
        WHEN ${whatsappCloudConversations.lastMessageAt} IS NULL
          OR ${whatsappCloudConversations.lastMessageAt} <= ${messageAt}
        THEN ${messageAt}
        ELSE ${whatsappCloudConversations.lastMessageAt}
      END`,
      lastMessagePreview: sql`CASE
        WHEN ${whatsappCloudConversations.lastMessageAt} IS NULL
          OR ${whatsappCloudConversations.lastMessageAt} <= ${messageAt}
        THEN ${preview}
        ELSE ${whatsappCloudConversations.lastMessagePreview}
      END`,
      lastMessageDirection: sql`CASE
        WHEN ${whatsappCloudConversations.lastMessageAt} IS NULL
          OR ${whatsappCloudConversations.lastMessageAt} <= ${messageAt}
        THEN ${input.direction}
        ELSE ${whatsappCloudConversations.lastMessageDirection}
      END`,
      unreadCount: input.incrementUnread
        ? sql`${whatsappCloudConversations.unreadCount} + 1`
        : whatsappCloudConversations.unreadCount,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappCloudConversations.workspaceId, input.workspaceId),
        eq(whatsappCloudConversations.environment, input.environment),
        eq(whatsappCloudConversations.id, input.conversationId),
      ),
    );
}

async function persistInboundMessage(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    workspaceId: string;
    environment: string;
    connectionId: string;
    messagingAccountId: string;
    phoneNumberId: string;
    message: WhatsAppCloudInboundMessage;
  },
): Promise<void> {
  const conversationId = await ensureConversation(transaction, {
    workspaceId: input.workspaceId,
    environment: input.environment,
    connectionId: input.connectionId,
    messagingAccountId: input.messagingAccountId,
    phoneNumberId: input.phoneNumberId,
    customerWaId: input.message.customerWaId,
    customerName: input.message.customerName,
  });
  const [inserted] = await transaction
    .insert(whatsappCloudMessages)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      environment: input.environment,
      conversationId,
      metaMessageId: input.message.metaMessageId,
      direction: "inbound",
      messageType: input.message.messageType,
      textBody: input.message.textBody,
      media: input.message.media,
      replyToMetaMessageId: input.message.replyToMetaMessageId,
      status: "received",
      statusAt: null,
      messageAt: input.message.messageAt,
    })
    .onConflictDoNothing({
      target: [
        whatsappCloudMessages.environment,
        whatsappCloudMessages.metaMessageId,
      ],
    })
    .returning({ id: whatsappCloudMessages.id });

  if (inserted) {
    await updateConversationForMessage(transaction, {
      workspaceId: input.workspaceId,
      environment: input.environment,
      conversationId,
      message: input.message,
      direction: "inbound",
      incrementUnread: true,
    });
    return;
  }

  const [existing] = await transaction
    .select()
    .from(whatsappCloudMessages)
    .where(
      and(
        eq(whatsappCloudMessages.environment, input.environment),
        eq(whatsappCloudMessages.metaMessageId, input.message.metaMessageId),
      ),
    )
    .for("update");
  if (
    !existing ||
    existing.workspaceId !== input.workspaceId ||
    existing.conversationId !== conversationId
  ) {
    throw new WhatsAppCloudWebhookProcessingError(
      "WHATSAPP_CLOUD_MESSAGE_SCOPE_CONFLICT",
    );
  }
  if (existing.messageType !== "status") return;

  await transaction
    .update(whatsappCloudMessages)
    .set({
      direction: "inbound",
      messageType: input.message.messageType,
      textBody: input.message.textBody,
      media: input.message.media,
      replyToMetaMessageId: input.message.replyToMetaMessageId,
      messageAt: input.message.messageAt,
      updatedAt: new Date(),
    })
    .where(eq(whatsappCloudMessages.id, existing.id));
  await updateConversationForMessage(transaction, {
    workspaceId: input.workspaceId,
    environment: input.environment,
    conversationId,
    message: input.message,
    direction: "inbound",
    incrementUnread: true,
  });
}

async function persistMessageStatus(
  transaction: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    workspaceId: string;
    environment: string;
    connectionId: string;
    messagingAccountId: string;
    phoneNumberId: string;
    status: WhatsAppCloudMessageStatus;
  },
): Promise<void> {
  const conversationId = await ensureConversation(transaction, {
    workspaceId: input.workspaceId,
    environment: input.environment,
    connectionId: input.connectionId,
    messagingAccountId: input.messagingAccountId,
    phoneNumberId: input.phoneNumberId,
    customerWaId: input.status.customerWaId,
    customerName: null,
  });

  await transaction
    .insert(whatsappCloudMessages)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      environment: input.environment,
      conversationId,
      metaMessageId: input.status.metaMessageId,
      direction: "outbound",
      messageType: "status",
      textBody: null,
      media: [],
      replyToMetaMessageId: null,
      status: input.status.status,
      statusAt: input.status.statusAt,
      messageAt: input.status.statusAt,
      statusErrorCode: input.status.errorCode,
    })
    .onConflictDoNothing({
      target: [
        whatsappCloudMessages.environment,
        whatsappCloudMessages.metaMessageId,
      ],
    });

  const [existing] = await transaction
    .select()
    .from(whatsappCloudMessages)
    .where(
      and(
        eq(whatsappCloudMessages.environment, input.environment),
        eq(whatsappCloudMessages.metaMessageId, input.status.metaMessageId),
      ),
    )
    .for("update");
  if (
    !existing ||
    existing.workspaceId !== input.workspaceId ||
    existing.conversationId !== conversationId
  ) {
    throw new WhatsAppCloudWebhookProcessingError(
      "WHATSAPP_CLOUD_MESSAGE_SCOPE_CONFLICT",
    );
  }
  if (!shouldAdvanceWhatsAppCloudMessageStatus(existing.status, input.status.status)) {
    return;
  }

  await transaction
    .update(whatsappCloudMessages)
    .set({
      direction: "outbound",
      status: input.status.status,
      statusAt: input.status.statusAt,
      statusErrorCode:
        input.status.status === "failed" ? input.status.errorCode : null,
      updatedAt: new Date(),
    })
    .where(eq(whatsappCloudMessages.id, existing.id));
}

async function processClaimedEvent(
  event: ClaimedWebhookEvent,
): Promise<void> {
  if (!event.workspaceId || !event.connectionId || !isRecord(event.payload)) {
    throw new WhatsAppCloudWebhookProcessingError(
      "WHATSAPP_CLOUD_EVENT_SCOPE_MISSING",
    );
  }
  if (event.eventType !== "messages") {
    const updated = await db
      .update(whatsappCloudWebhookEvents)
      .set({
        status: "processed",
        payload: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        processedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappCloudWebhookEvents.id, event.id),
          eq(whatsappCloudWebhookEvents.status, "processing"),
          eq(whatsappCloudWebhookEvents.attempts, event.attempts),
        ),
      )
      .returning({ id: whatsappCloudWebhookEvents.id });
    if (!updated[0]) {
      throw new WhatsAppCloudWebhookProcessingError(
        "WHATSAPP_CLOUD_EVENT_LEASE_LOST",
      );
    }
    return;
  }

  const workspaceId = event.workspaceId;
  const connectionId = event.connectionId;
  if (event.payload.metaMessagingAccountId !== event.metaMessagingAccountId) {
    throw new WhatsAppCloudWebhookProcessingError(
      "WHATSAPP_CLOUD_MESSAGING_ACCOUNT_MISMATCH",
    );
  }
  const parsed = parseWhatsAppCloudMessageChange(
    event.payload,
    new Date(),
  );
  if (!parsed) {
    throw new WhatsAppCloudWebhookProcessingError(
      "WHATSAPP_CLOUD_MESSAGE_CHANGE_INVALID",
    );
  }

  await db.transaction(async (transaction) => {
    const accounts = await transaction
      .select({
        id: whatsappCloudMessagingAccounts.id,
        environment: whatsappCloudMessagingAccounts.environment,
      })
      .from(whatsappCloudMessagingAccounts)
      .where(
        and(
          eq(whatsappCloudMessagingAccounts.workspaceId, workspaceId),
          eq(whatsappCloudMessagingAccounts.connectionId, connectionId),
          eq(
            whatsappCloudMessagingAccounts.metaMessagingAccountId,
            event.metaMessagingAccountId,
          ),
        ),
      )
      .limit(2);
    if (accounts.length !== 1) {
      throw new WhatsAppCloudWebhookProcessingError(
        "WHATSAPP_CLOUD_MESSAGING_ACCOUNT_NOT_UNIQUE",
      );
    }
    const account = accounts[0]!;
    const phones = await transaction
      .select({
        id: whatsappCloudPhoneNumbers.id,
      })
      .from(whatsappCloudMessagingAccountPhoneNumbers)
      .innerJoin(
        whatsappCloudPhoneNumbers,
        and(
          eq(
            whatsappCloudPhoneNumbers.workspaceId,
            whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
          ),
          eq(
            whatsappCloudPhoneNumbers.environment,
            whatsappCloudMessagingAccountPhoneNumbers.environment,
          ),
          eq(
            whatsappCloudPhoneNumbers.id,
            whatsappCloudMessagingAccountPhoneNumbers.phoneNumberId,
          ),
        ),
      )
      .where(
        and(
          eq(
            whatsappCloudMessagingAccountPhoneNumbers.workspaceId,
            workspaceId,
          ),
          eq(
            whatsappCloudMessagingAccountPhoneNumbers.environment,
            account.environment,
          ),
          eq(
            whatsappCloudMessagingAccountPhoneNumbers.messagingAccountId,
            account.id,
          ),
          eq(whatsappCloudPhoneNumbers.metaPhoneNumberId, parsed.metaPhoneNumberId),
        ),
      )
      .limit(2);
    if (phones.length !== 1) {
      throw new WhatsAppCloudWebhookProcessingError(
        "WHATSAPP_CLOUD_PHONE_NUMBER_NOT_LINKED",
      );
    }
    const phoneNumberId = phones[0]!.id;
    for (const message of parsed.messages) {
      await persistInboundMessage(transaction, {
        workspaceId,
        environment: account.environment,
        connectionId,
        messagingAccountId: account.id,
        phoneNumberId,
        message,
      });
    }
    for (const status of parsed.statuses) {
      await persistMessageStatus(transaction, {
        workspaceId,
        environment: account.environment,
        connectionId,
        messagingAccountId: account.id,
        phoneNumberId,
        status,
      });
    }

    const updated = await transaction
      .update(whatsappCloudWebhookEvents)
      .set({
        status: "processed",
        payload: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        processedAt: new Date(),
      })
      .where(
        and(
          eq(whatsappCloudWebhookEvents.id, event.id),
          eq(whatsappCloudWebhookEvents.workspaceId, workspaceId),
          eq(whatsappCloudWebhookEvents.connectionId, connectionId),
          eq(whatsappCloudWebhookEvents.status, "processing"),
          eq(whatsappCloudWebhookEvents.attempts, event.attempts),
        ),
      )
      .returning({ id: whatsappCloudWebhookEvents.id });
    if (!updated[0]) {
      throw new WhatsAppCloudWebhookProcessingError(
        "WHATSAPP_CLOUD_EVENT_LEASE_LOST",
      );
    }
  });
}

async function releaseFailedEvent(
  event: ClaimedWebhookEvent,
  code: string,
): Promise<void> {
  const retryDelayMs = Math.min(5 * 60_000, 5_000 * 2 ** (event.attempts - 1));
  await db
    .update(whatsappCloudWebhookEvents)
    .set({
      status: event.attempts >= maxAttempts ? "failed" : "received",
      nextAttemptAt: new Date(Date.now() + retryDelayMs),
      leaseExpiresAt: null,
      lastErrorCode: code,
    })
    .where(
      and(
        eq(whatsappCloudWebhookEvents.id, event.id),
        eq(whatsappCloudWebhookEvents.status, "processing"),
        eq(whatsappCloudWebhookEvents.attempts, event.attempts),
      ),
    );
  logger.warn(
    {
      eventId: event.id,
      workspaceId: event.workspaceId,
      attempt: event.attempts,
      terminal: event.attempts >= maxAttempts,
      errorCode: code,
    },
    "WhatsApp Cloud webhook event processing failed",
  );
}

export async function processWhatsAppCloudWebhookQueue(): Promise<number> {
  if (workerRunning) return 0;
  workerRunning = true;
  try {
    const events = await claimEvents();
    let processed = 0;
    for (const event of events) {
      try {
        await processClaimedEvent(event);
        processed += 1;
      } catch (error) {
        await releaseFailedEvent(event, errorCode(error));
      }
    }
    return processed;
  } finally {
    workerRunning = false;
  }
}
