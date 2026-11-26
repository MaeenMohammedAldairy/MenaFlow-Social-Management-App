import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  db,
  menaWhatsAppAutoReplyEvents,
  menaWhatsAppConnections,
  menaWhatsAppDirectMessageMedia,
  menaWhatsAppDirectMessages,
} from "@workspace/db";
import { requireOwnerId } from "../lib/owner-access";
import {
  PublicMediaUrlError,
  signedWhatsAppMediaUrl,
} from "../lib/public-media-url.ts";
import {
  serializeWhatsAppDirectAttachment,
  type WhatsAppDirectAttachmentView,
} from "../lib/whatsapp-direct-media.ts";
import { sendWhatsAppAutoReply } from "../lib/whatsapp-auto-reply";
import {
  decryptWhatsAppDirectMessageValue,
  isWhatsAppDirectPhoneJid,
  normalizeWhatsAppDirectJid,
  whatsappDirectMessagePlaceholder,
  whatsappDirectConversationKeys,
  normalizeWhatsAppDirectSenderName,
  outboundWhatsAppDirectMessageValues,
} from "../lib/whatsapp-direct-messages";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();
const conversationPageSize = 100;
const conversationScanLimit = 500;
const messagePageSize = 100;

function parseRemoteJid(value: unknown): string | null {
  return normalizeWhatsAppDirectJid(value);
}

function parseClientRequestId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(value)
    ? value
    : null;
}

function parseReplyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= 2000 ? text : null;
}

async function connectionForRequest(ownerId: string, workspaceId: string) {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(
      and(
        eq(menaWhatsAppConnections.ownerId, ownerId),
        eq(menaWhatsAppConnections.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  return connection ?? null;
}

type DirectMediaRow = typeof menaWhatsAppDirectMessageMedia.$inferSelect;

type DirectMediaAttachment = WhatsAppDirectAttachmentView;

function signedMediaUrl(
  mediaId: string,
  variant: "original" | "thumbnail" | null,
  requestOrigin?: string,
): { url: string | null; accessError: string | null } {
  try {
    return {
      url: signedWhatsAppMediaUrl(
        mediaId,
        true,
        variant ?? "original",
        requestOrigin,
      ),
      accessError: null,
    };
  } catch (error) {
    if (error instanceof PublicMediaUrlError) {
      return { url: null, accessError: error.reason };
    }
    throw error;
  }
}

function attachmentResponse(
  media: DirectMediaRow,
  requestOrigin?: string,
): DirectMediaAttachment {
  return serializeWhatsAppDirectAttachment(media, (variant) =>
    signedMediaUrl(media.id, variant, requestOrigin),
  );
}

function messageResponse(
  message: typeof menaWhatsAppDirectMessages.$inferSelect,
  autoReplyStatus: string | null = null,
  autoReplyErrorCode: string | null = null,
  attachments: DirectMediaAttachment[] = [],
) {
  const remoteJid = decryptWhatsAppDirectMessageValue(
    message.encryptedRemoteJid,
  );
  const text = decryptWhatsAppDirectMessageValue(message.encryptedTextBody);
  return {
    id: message.id,
    remoteJid,
    direction: message.direction,
    status: message.status,
    autoReplyStatus,
    autoReplyErrorCode,
    text,
    messageType: text.trim() ? "text" : "unknown",
    occurredAt: message.messageTimestamp,
    createdAt: message.createdAt,
    errorCode: message.errorCode,
    attachments,
  };
}

router.get(
  "/social/whatsapp/direct-conversations",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    const workspaceId = requestWorkspaceId(req);
    const connection = await connectionForRequest(ownerId, workspaceId);
    if (!connection) {
      res.status(404).json({ error: "لا يوجد حساب واتساب مرتبط بهذه المساحة." });
      return;
    }
    const now = new Date();
    const rows = await db
      .select()
      .from(menaWhatsAppDirectMessages)
      .where(
        and(
          eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          eq(menaWhatsAppDirectMessages.instanceName, connection.instanceName),
          gt(menaWhatsAppDirectMessages.expiresAt, now),
        ),
      )
      .orderBy(
        desc(menaWhatsAppDirectMessages.messageTimestamp),
        desc(menaWhatsAppDirectMessages.createdAt),
      )
      .limit(conversationScanLimit);

    const latestByConversation = new Map<
      string,
      { message: typeof rows[number]; text: string; senderName: string | null }
    >();
    let skippedEncryptedMessages = 0;
    for (const row of rows) {
      try {
        const remoteJid = decryptWhatsAppDirectMessageValue(
          row.encryptedRemoteJid,
        );
        const senderName = normalizeWhatsAppDirectSenderName(row.senderName);
        const existing = latestByConversation.get(remoteJid);
        if (!existing) {
          latestByConversation.set(remoteJid, {
            message: row,
            text: decryptWhatsAppDirectMessageValue(row.encryptedTextBody),
            senderName,
          });
        } else if (!existing.senderName && senderName) {
          // Keep the newest message for the preview, but display a name from
          // any message in the scanned window instead of an older blank label.
          existing.senderName = senderName;
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "INVALID_ENCRYPTED_TOKEN"
        ) {
          throw error;
        }
        skippedEncryptedMessages += 1;
      }
    }
    if (skippedEncryptedMessages > 0) {
      req.log.warn(
        { count: skippedEncryptedMessages },
        "Skipped WhatsApp messages with unreadable encrypted content",
      );
    }
    const conversations = [...latestByConversation.values()]
      .slice(0, conversationPageSize)
      .map(({ message, text, senderName }) => {
        const remoteJid = decryptWhatsAppDirectMessageValue(
          message.encryptedRemoteJid,
        );
        return {
          remoteJid,
          senderName,
          customerNumber: remoteJid.endsWith("@s.whatsapp.net")
            ? remoteJid.replace(/@s\.whatsapp\.net$/, "")
            : `معرّف ${remoteJid.replace(/@lid$/, "")}`,
          preview: text || whatsappDirectMessagePlaceholder("unknown"),
          lastDirection: message.direction,
          lastStatus: message.status,
          lastMessageAt: message.messageTimestamp,
        };
      });

    res.json({ conversations });
  },
);

router.get(
  "/social/whatsapp/direct-messages",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    const remoteJid = parseRemoteJid(req.query.remoteJid);
    if (!remoteJid) {
      res.status(400).json({ error: "معرّف محادثة واتساب غير صالح." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const connection = await connectionForRequest(ownerId, workspaceId);
    if (!connection) {
      res.status(404).json({ error: "لا يوجد حساب واتساب مرتبط بهذه المساحة." });
      return;
    }
    const hasCursor =
      req.query.beforeTimestamp !== undefined || req.query.beforeId !== undefined;
    const beforeTimestampValue =
      typeof req.query.beforeTimestamp === "string"
        ? new Date(req.query.beforeTimestamp)
        : null;
    const beforeId =
      typeof req.query.beforeId === "string" ? req.query.beforeId.trim() : "";
    if (
      hasCursor &&
      (!beforeTimestampValue ||
        !Number.isFinite(beforeTimestampValue.getTime()) ||
        !beforeId ||
        beforeId.length > 200)
    ) {
      res.status(400).json({ error: "مؤشر الرسائل الأقدم غير صالح." });
      return;
    }
    const conversationKeys = whatsappDirectConversationKeys(
      workspaceId,
      connection.instanceName,
      remoteJid,
    );
    const cursorCondition =
      beforeTimestampValue && beforeId
        ? or(
            lt(
              menaWhatsAppDirectMessages.messageTimestamp,
              beforeTimestampValue,
            ),
            and(
              eq(
                menaWhatsAppDirectMessages.messageTimestamp,
                beforeTimestampValue,
              ),
              lt(menaWhatsAppDirectMessages.id, beforeId),
            ),
          )
        : undefined;
    const fetchedMessages = await db
      .select()
      .from(menaWhatsAppDirectMessages)
      .where(
        and(
          eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          eq(menaWhatsAppDirectMessages.instanceName, connection.instanceName),
          inArray(menaWhatsAppDirectMessages.remoteJidHash, conversationKeys),
          gt(menaWhatsAppDirectMessages.expiresAt, new Date()),
          ...(cursorCondition ? [cursorCondition] : []),
        ),
      )
      .orderBy(
        desc(menaWhatsAppDirectMessages.messageTimestamp),
        desc(menaWhatsAppDirectMessages.id),
      )
      .limit(messagePageSize + 1);
    const hasNextPage = fetchedMessages.length > messagePageSize;
    const messages = fetchedMessages.slice(0, messagePageSize);
    const oldestMessage = messages.at(-1);
    const nextCursor =
      hasNextPage && oldestMessage
        ? {
            beforeTimestamp: oldestMessage.messageTimestamp.toISOString(),
            beforeId: oldestMessage.id,
          }
        : null;

    const inboundIds = messages
      .filter((message) => message.direction === "inbound" && message.providerMessageId)
      .map((message) => message.providerMessageId!);
    const autoReplyEvents = inboundIds.length
      ? await db
          .select({
            remoteMessageId: menaWhatsAppAutoReplyEvents.remoteMessageId,
            status: menaWhatsAppAutoReplyEvents.status,
            errorCode: menaWhatsAppAutoReplyEvents.errorCode,
          })
          .from(menaWhatsAppAutoReplyEvents)
          .where(
            and(
              eq(menaWhatsAppAutoReplyEvents.workspaceId, workspaceId),
              eq(menaWhatsAppAutoReplyEvents.instanceName, connection.instanceName),
              inArray(menaWhatsAppAutoReplyEvents.remoteMessageId, inboundIds),
            ),
          )
      : [];
    const autoReplyByMessage = new Map(
      autoReplyEvents.map((event) => [
        event.remoteMessageId,
        { status: event.status, errorCode: event.errorCode },
      ]),
    );
    const uniqueMessages = new Map<string, typeof messages[number]>();
    for (const message of messages.reverse()) {
      const key = message.providerMessageId ?? message.id;
      if (!uniqueMessages.has(key)) uniqueMessages.set(key, message);
    }
    const directMessageIds = [...uniqueMessages.values()].map((message) => message.id);
    const attachmentRows = directMessageIds.length
      ? await db
          .select()
          .from(menaWhatsAppDirectMessageMedia)
          .where(
            and(
              eq(menaWhatsAppDirectMessageMedia.workspaceId, workspaceId),
              eq(menaWhatsAppDirectMessageMedia.instanceName, connection.instanceName),
              inArray(menaWhatsAppDirectMessageMedia.directMessageId, directMessageIds),
            ),
          )
          .orderBy(
            menaWhatsAppDirectMessageMedia.directMessageId,
            menaWhatsAppDirectMessageMedia.mediaIndex,
          )
      : [];
    const attachmentsByMessage = new Map<string, DirectMediaAttachment[]>();
    const requestOrigin = req.get("host")
      ? `${req.protocol}://${req.get("host")}`
      : undefined;
    for (const media of attachmentRows) {
      const list = attachmentsByMessage.get(media.directMessageId) ?? [];
      list.push(attachmentResponse(media, requestOrigin));
      attachmentsByMessage.set(media.directMessageId, list);
    }
    const responseMessages: ReturnType<typeof messageResponse>[] = [];
    let skippedEncryptedMessages = 0;
    for (const message of uniqueMessages.values()) {
      const autoReply =
        message.direction === "inbound" && message.providerMessageId
          ? autoReplyByMessage.get(message.providerMessageId)
          : undefined;
      try {
        responseMessages.push(
          messageResponse(
            message,
            autoReply?.status ?? null,
            autoReply?.errorCode ?? null,
            attachmentsByMessage.get(message.id) ?? [],
          ),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "INVALID_ENCRYPTED_TOKEN"
        ) {
          throw error;
        }
        skippedEncryptedMessages += 1;
      }
    }
    if (skippedEncryptedMessages > 0) {
      req.log.warn(
        { count: skippedEncryptedMessages },
        "Skipped WhatsApp messages with unreadable encrypted content",
      );
    }
    res.json({ messages: responseMessages, nextCursor });
  },
);

router.post(
  "/social/whatsapp/direct-messages/reply",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    const remoteJid = parseRemoteJid(req.body?.remoteJid);
    const text = parseReplyText(req.body?.text);
    const clientRequestId = parseClientRequestId(req.body?.clientRequestId);
    if (!remoteJid) {
      res.status(400).json({
        error: "معرّف محادثة واتساب غير صالح.",
      });
      return;
    }
    if (!isWhatsAppDirectPhoneJid(remoteJid)) {
      res.status(409).json({
        error:
          "لا يمكن إرسال الرد لأن واتساب لم يوفّر رقم الهاتف البديل لهذا المعرّف.",
      });
      return;
    }
    if (!text || !clientRequestId) {
      res.status(400).json({
        error: "تحقق من نص الرد ومعرّف الطلب.",
      });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const connection = await connectionForRequest(ownerId, workspaceId);
    if (!connection) {
      res.status(404).json({ error: "لا يوجد حساب واتساب مرتبط بهذه المساحة." });
      return;
    }

    const now = new Date();
    const conversationKeys = whatsappDirectConversationKeys(
      workspaceId,
      connection.instanceName,
      remoteJid,
    );
    const conversationKey = conversationKeys[0]!;
    const [existingInbound] = await db
      .select({ id: menaWhatsAppDirectMessages.id })
      .from(menaWhatsAppDirectMessages)
      .where(
        and(
          eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          eq(menaWhatsAppDirectMessages.instanceName, connection.instanceName),
          inArray(menaWhatsAppDirectMessages.remoteJidHash, conversationKeys),
          eq(menaWhatsAppDirectMessages.direction, "inbound"),
          gt(menaWhatsAppDirectMessages.expiresAt, now),
        ),
      )
      .limit(1);
    if (!existingInbound) {
      res.status(404).json({ error: "لم يتم العثور على محادثة واردة لهذا الرقم." });
      return;
    }
    const [queued] = await db
      .insert(menaWhatsAppDirectMessages)
      .values(
        outboundWhatsAppDirectMessageValues({
          ownerId,
          workspaceId,
          instanceName: connection.instanceName,
          remoteJid,
          text,
          status: "sending",
          messageTimestamp: now,
          clientRequestId,
        }),
      )
      .onConflictDoNothing()
      .returning();
    if (!queued) {
      const [existing] = await db
        .select()
        .from(menaWhatsAppDirectMessages)
        .where(
          and(
            eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
            eq(menaWhatsAppDirectMessages.instanceName, connection.instanceName),
            eq(menaWhatsAppDirectMessages.clientRequestId, clientRequestId),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(409).json({ error: "تعذر تأكيد حالة الرد؛ حدّث المحادثة." });
        return;
      }
      if (
        existing.remoteJidHash !== conversationKey ||
        decryptWhatsAppDirectMessageValue(existing.encryptedTextBody) !== text
      ) {
        res.status(409).json({
          error: "استُخدم معرّف إرسال سابق لمحتوى مختلف. أنشئ ردًا جديدًا.",
        });
        return;
      }
      res.json({ message: messageResponse(existing), duplicate: true });
      return;
    }

    try {
      const providerMessageId = await sendWhatsAppAutoReply(
        connection.instanceName,
        remoteJid,
        text,
      );
      const [sent] = await db
        .update(menaWhatsAppDirectMessages)
        .set({
          providerMessageId,
          status: "sent",
        })
        .where(
          and(
            eq(menaWhatsAppDirectMessages.id, queued.id),
            eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          ),
        )
        .returning();
      res.status(201).json({ message: sent ? messageResponse(sent) : null });
    } catch {
      const [unknown] = await db
        .update(menaWhatsAppDirectMessages)
        .set({ status: "unknown", errorCode: "MANUAL_SEND_RESULT_UNKNOWN" })
        .where(
          and(
            eq(menaWhatsAppDirectMessages.id, queued.id),
            eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          ),
        )
        .returning();
      res.status(502).json({
        error:
          "نتيجة إرسال الرد غير مؤكدة. تحقق من محادثة واتساب قبل إعادة المحاولة.",
        message: unknown ? messageResponse(unknown) : null,
      });
    }
  },
);

router.post(
  "/social/whatsapp/direct-messages/:id/confirm-not-sent",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requireOwnerId(req, res);
    if (!ownerId) return;
    const messageId =
      typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!messageId || messageId.length > 200) {
      res.status(400).json({ error: "معرّف الرد غير صالح." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const [message] = await db
      .update(menaWhatsAppDirectMessages)
      .set({
        status: "failed",
        errorCode: "MANUAL_CONFIRMED_NOT_SENT",
      })
      .where(
        and(
          eq(menaWhatsAppDirectMessages.id, messageId),
          eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          eq(menaWhatsAppDirectMessages.direction, "outbound"),
          eq(menaWhatsAppDirectMessages.status, "unknown"),
        ),
      )
      .returning();
    if (message) {
      res.json({ message: messageResponse(message) });
      return;
    }
    const [inboundMessage] = await db
      .select()
      .from(menaWhatsAppDirectMessages)
      .where(
        and(
          eq(menaWhatsAppDirectMessages.id, messageId),
          eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          eq(menaWhatsAppDirectMessages.direction, "inbound"),
        ),
      )
      .limit(1);
    if (inboundMessage?.providerMessageId) {
      const [event] = await db
        .update(menaWhatsAppAutoReplyEvents)
        .set({
          status: "failed",
          errorCode: "MANUAL_CONFIRMED_NOT_SENT",
          leaseExpiresAt: null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(menaWhatsAppAutoReplyEvents.workspaceId, workspaceId),
            eq(menaWhatsAppAutoReplyEvents.instanceName, inboundMessage.instanceName),
            eq(
              menaWhatsAppAutoReplyEvents.remoteMessageId,
              inboundMessage.providerMessageId,
            ),
            eq(menaWhatsAppAutoReplyEvents.status, "unknown"),
          ),
        )
        .returning({ id: menaWhatsAppAutoReplyEvents.id });
      if (event) {
        res.json({
          message: messageResponse(inboundMessage, "failed"),
        });
        return;
      }
    }
    res.status(409).json({
      error: "لا يمكن إعادة المحاولة إلا بعد تأكيد نتيجة إرسال غير محسومة.",
    });
  },
);

export default router;