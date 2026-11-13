import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import {
  db,
  menaWhatsAppAutoReplyEvents,
  menaWhatsAppConnections,
  menaWhatsAppDirectMessages,
} from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import { sendWhatsAppAutoReply } from "../lib/whatsapp-auto-reply";
import {
  decryptWhatsAppDirectMessageValue,
  encryptWhatsAppDirectMessageValue,
  normalizeWhatsAppDirectMessageText,
  whatsappDirectConversationKeys,
  whatsappDirectMessageExpiry,
} from "../lib/whatsapp-direct-messages";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();
const conversationPageSize = 100;
const conversationScanLimit = 500;
const messagePageSize = 100;

function parseRemoteJid(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 120 ||
    !/^\d{7,20}@s\.whatsapp\.net$/.test(value)
  ) {
    return null;
  }
  return value;
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

function messageResponse(
  message: typeof menaWhatsAppDirectMessages.$inferSelect,
  autoReplyStatus: string | null = null,
) {
  const remoteJid = decryptWhatsAppDirectMessageValue(
    message.encryptedRemoteJid,
  );
  return {
    id: message.id,
    remoteJid,
    direction: message.direction,
    status: message.status,
    autoReplyStatus,
    text: decryptWhatsAppDirectMessageValue(message.encryptedTextBody),
    occurredAt: message.messageTimestamp,
    createdAt: message.createdAt,
    errorCode: message.errorCode,
  };
}

router.get(
  "/social/whatsapp/direct-conversations",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
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
      { message: typeof rows[number]; text: string }
    >();
    for (const row of rows) {
      const remoteJid = decryptWhatsAppDirectMessageValue(
        row.encryptedRemoteJid,
      );
      if (!latestByConversation.has(remoteJid)) {
        latestByConversation.set(remoteJid, {
          message: row,
          text: decryptWhatsAppDirectMessageValue(row.encryptedTextBody),
        });
      }
    }
    const conversations = [...latestByConversation.values()]
      .slice(0, conversationPageSize)
      .map(({ message, text }) => ({
        remoteJid: decryptWhatsAppDirectMessageValue(message.encryptedRemoteJid),
        customerNumber: decryptWhatsAppDirectMessageValue(
          message.encryptedRemoteJid,
        ).replace(/@s\.whatsapp\.net$/, ""),
        preview: text,
        lastDirection: message.direction,
        lastStatus: message.status,
        lastMessageAt: message.messageTimestamp,
      }));

    res.json({ conversations });
  },
);

router.get(
  "/social/whatsapp/direct-messages",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
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
    const conversationKeys = whatsappDirectConversationKeys(
      workspaceId,
      connection.instanceName,
      remoteJid,
    );
    const messages = await db
      .select()
      .from(menaWhatsAppDirectMessages)
      .where(
        and(
          eq(menaWhatsAppDirectMessages.workspaceId, workspaceId),
          eq(menaWhatsAppDirectMessages.instanceName, connection.instanceName),
          inArray(menaWhatsAppDirectMessages.remoteJidHash, conversationKeys),
          gt(menaWhatsAppDirectMessages.expiresAt, new Date()),
        ),
      )
      .orderBy(
        desc(menaWhatsAppDirectMessages.messageTimestamp),
        desc(menaWhatsAppDirectMessages.createdAt),
      )
      .limit(messagePageSize);

    const inboundIds = messages
      .filter((message) => message.direction === "inbound" && message.providerMessageId)
      .map((message) => message.providerMessageId!);
    const autoReplyEvents = inboundIds.length
      ? await db
          .select({
            remoteMessageId: menaWhatsAppAutoReplyEvents.remoteMessageId,
            status: menaWhatsAppAutoReplyEvents.status,
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
    const autoReplyStatusByMessage = new Map(
      autoReplyEvents.map((event) => [event.remoteMessageId, event.status]),
    );
    const uniqueMessages = new Map<string, typeof messages[number]>();
    for (const message of messages.reverse()) {
      const key = message.providerMessageId ?? message.id;
      if (!uniqueMessages.has(key)) uniqueMessages.set(key, message);
    }
    res.json({
      messages: [...uniqueMessages.values()].map((message) =>
        messageResponse(
          message,
          message.direction === "inbound" && message.providerMessageId
            ? autoReplyStatusByMessage.get(message.providerMessageId) ?? null
            : null,
        ),
      ),
    });
  },
);

router.post(
  "/social/whatsapp/direct-messages/reply",
  requireWorkspace,
  async (req: Request, res: Response) => {
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const remoteJid = parseRemoteJid(req.body?.remoteJid);
    const text = parseReplyText(req.body?.text);
    const clientRequestId = parseClientRequestId(req.body?.clientRequestId);
    if (!remoteJid || !text || !clientRequestId) {
      res.status(400).json({
        error: "تحقق من رقم المحادثة ونص الرد ومعرّف الطلب.",
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
      .values({
        id: randomUUID(),
        ownerId,
        workspaceId,
        instanceName: connection.instanceName,
        remoteJidHash: conversationKey,
        encryptedRemoteJid: encryptWhatsAppDirectMessageValue(remoteJid),
        clientRequestId,
        direction: "outbound",
        status: "sending",
        encryptedTextBody: encryptWhatsAppDirectMessageValue(
          normalizeWhatsAppDirectMessageText(text),
        ),
        messageTimestamp: now,
        expiresAt: whatsappDirectMessageExpiry(now),
      })
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
    const ownerId = requestOwnerId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
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