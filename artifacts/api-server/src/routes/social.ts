import { and, eq, inArray, sql } from "drizzle-orm";

import {
  db,
  pool,
  menaMetaConnections,
  menaMetaWebhookSubscriptions,
  menaWhatsAppConnections,
  menaWhatsAppGroups,
  menaWhatsAppGroupJids,
  menaWhatsAppGroupSelections,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { metaAuthorizationStatus } from "../lib/meta-oauth";
import {
  filterHistoryRecordsForGroup,
  extractRemoteJidFromEnvelope,
} from "../lib/whatsapp-message-scope";

import {
  configureWhatsAppWebhook,
  EvolutionApiError,
  clearConnectionStateCache,
  evolutionConnectionState,
  evolutionRequest,
  isExclusiveWhatsAppInstance,
  mapEvolutionConnectionState,
} from "../lib/whatsapp-evolution";

import { whatsappInstanceNameForWorkspace } from "../lib/whatsapp-instance";

import { connectedWhatsAppForWorkspace } from "./whatsapp-groups";
import { evolutionErrorResponse } from "./whatsapp-route-errors";
import { asRecord, queryString } from "../lib/value-utils.ts";

import {
  pairingCodeFrom,
  pairingQrBase64From,
} from "../lib/whatsapp-pairing";
import { canConnectChannel } from "../lib/subscriptions";

const router: IRouter = Router();
const MAX_WHATSAPP_GROUP_SELECTIONS = 500;

export { extractRemoteJidFromEnvelope, filterHistoryRecordsForGroup };

router.get("/social/connections", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);

  const webhookSubscriptions = connection
    ? await db
        .select({ platform: menaMetaWebhookSubscriptions.platform, accountId: menaMetaWebhookSubscriptions.accountId, lastErrorCode: menaMetaWebhookSubscriptions.lastErrorCode })
        .from(menaMetaWebhookSubscriptions)
        .where(eq(menaMetaWebhookSubscriptions.workspaceId, workspaceId))
    : [];
  const metaStatus = (
    platform: "facebook" | "instagram",
    accountId: string,
  ) => {
    if (!connection) return null;
    const tokenInvalid = webhookSubscriptions.some(
      (subscription) =>
        subscription.platform === platform &&
        subscription.accountId === accountId &&
        subscription.lastErrorCode === "token_invalid",
    );
    return metaAuthorizationStatus({ ...connection, tokenInvalid }, platform);
  };

  const [waConnection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
    .limit(1);

  let whatsappState:
    | "connected"
    | "connecting"
    | "disconnected"
    | "failed"
    | "missing"
    | "unavailable"
    | null = null;
  if (waConnection) {
    try {
      const providerState = await evolutionConnectionState(
        waConnection.instanceName,
      );
      whatsappState = mapEvolutionConnectionState(
        providerState,
        waConnection.status === "failed",
      );
    } catch (err) {
      if (err instanceof EvolutionApiError && err.statusCode === 404) {
        whatsappState = "missing";
      } else {
        console.warn("Unable to verify WhatsApp connection state", {
          workspaceId,
          statusCode: err instanceof EvolutionApiError ? err.statusCode : null,
        });
        whatsappState =
          waConnection.status === "failed" ? "failed" : "unavailable";
      }
    }
    if (whatsappState === "connected" && waConnection.status !== "connected") {
      await db
        .update(menaWhatsAppConnections)
        .set({ status: "connected", connectedAt: new Date() })
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
    } else if (
      whatsappState === "connecting" &&
      waConnection.status !== "connecting"
    ) {
      await db
        .update(menaWhatsAppConnections)
        .set({ status: "connecting" })
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
    } else if (
      whatsappState === "disconnected" &&
      waConnection.status !== "disconnected"
    ) {
      await db
        .update(menaWhatsAppConnections)
        .set({ status: "disconnected" })
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
    }
  }

  res.json({
    facebook: connection
      ? {
          accountId: connection.pageId,
          accountName: connection.pageName,
          connectedAt: connection.connectedAt.toISOString(),
          ...metaStatus("facebook", connection.pageId),
        }
      : null,
    instagram:
      connection?.instagramUserId && connection.instagramUsername
        ? {
            accountId: connection.instagramUserId,
            accountName: connection.instagramUsername,
            connectedAt: connection.connectedAt.toISOString(),
            ...metaStatus("instagram", connection.instagramUserId),
          }
        : null,
    whatsapp: waConnection
      ? {
          accountId: waConnection.instanceName,
          accountName: waConnection.phoneNumber || waConnection.instanceName,
          connectedAt: waConnection.connectedAt.toISOString(),
          connected: whatsappState === "connected",
          connectionState: whatsappState ?? "unavailable",
          instanceName: waConnection.instanceName,
          phoneNumber: waConnection.phoneNumber || undefined,
        }
      : null,
  });
});

router.post("/social/whatsapp/connect", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const channelAccess = await canConnectChannel(workspaceId, "whatsapp");
  if (!channelAccess.allowed) {
    res.status(403).json({
      error: "بلغت الحد الأقصى لقنوات خطتك الحالية. تظهر خيارات الترقية قريبًا.",
      code: "SUBSCRIPTION_LIMIT_REACHED",
      usage: channelAccess.used,
      limit: channelAccess.limit,
    });
    return;
  }

  const inputPhone =
    typeof req.body?.phoneNumber === "string"
      ? req.body.phoneNumber.trim()
      : "";
  const phoneNumber = inputPhone.replace(/[\s().-]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(phoneNumber)) {
    res.status(400).json({
      error: "أدخل رقم هاتف دولي صحيحاً مع رمز الدولة.",
    });
    return;
  }
  const evolutionPhoneNumber = phoneNumber.replace(/^\+/, "");

  const refreshCode = req.body?.refreshCode === true;
  let unlockAndRelease: (() => Promise<void>) | null = null;
  let pairingInstanceName: string | null = null;
  let pairingAttemptPersisted = false;
  try {
    const lockClient = await pool.connect();
    let lockAcquired = false;
    unlockAndRelease = async () => {
      try {
        if (lockAcquired) {
          await lockClient.query(
            "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
            [`menaflow:whatsapp-pairing:${workspaceId}`],
          );
        }
      } catch (unlockError) {
        console.error("Failed to release WhatsApp pairing lock:", unlockError);
      } finally {
        lockClient.release();
      }
    };
    const lockKey = `menaflow:whatsapp-pairing:${workspaceId}`;
    await lockClient.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      lockKey,
    ]);
    lockAcquired = true;

    const existingRows = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
      .limit(1);
    const existingConnection = existingRows[0];
    let evolutionState: string | null = null;
    let existingInstanceMissing = false;

    if (existingConnection) {
      try {
        evolutionState = await evolutionConnectionState(
          existingConnection.instanceName,
        );
        if (evolutionState === "open") {
          const existingPhoneNumber = existingConnection.phoneNumber?.replace(
            /\D/g,
            "",
          );
          const requestedPhoneNumber = phoneNumber.replace(/\D/g, "");
          res.status(409).json({
            error:
              existingPhoneNumber &&
              existingPhoneNumber === requestedPhoneNumber
                ? "رقم الهاتف هذا مربوط بالفعل بحساب واتساب في مساحة العمل."
                : "يوجد حساب واتساب متصل بالفعل. افصله قبل ربط حساب آخر.",
          });
          return;
        }
      } catch (err) {
        if (err instanceof EvolutionApiError && err.statusCode === 404) {
          existingInstanceMissing = true;
        } else {
          throw err;
        }
      }
    }

    const instanceName =
      existingConnection?.instanceName ??
      whatsappInstanceNameForWorkspace(workspaceId);
    const instanceConnections = existingConnection
      ? await db
          .select({ ownerId: menaWhatsAppConnections.ownerId })
          .from(menaWhatsAppConnections)
          .where(eq(menaWhatsAppConnections.instanceName, instanceName))
      : [];
    if (
      existingConnection &&
      !isExclusiveWhatsAppInstance(
        existingConnection.ownerId,
        instanceConnections.map(
          ({ ownerId: connectionOwnerId }) => connectionOwnerId,
        ),
      )
    ) {
      res.status(409).json({
        error: "تعذر التحقق من ملكية جلسة واتساب. لا يمكن إعادة استخدامها.",
      });
      return;
    }

    const samePhone =
      existingConnection?.phoneNumber?.replace(/\D/g, "") ===
      phoneNumber.replace(/\D/g, "");
    const recreateInstance =
      !existingConnection ||
      existingInstanceMissing ||
      refreshCode ||
      !samePhone ||
      existingConnection.status !== "connecting" ||
      evolutionState !== "connecting";

    const finalChannelAccess = await canConnectChannel(
      workspaceId,
      "whatsapp",
    );
    if (!finalChannelAccess.allowed) {
      res.status(403).json({
        error: "بلغت الحد الأقصى لقنوات خطتك الحالية. تظهر خيارات الترقية قريبًا.",
        code: "SUBSCRIPTION_LIMIT_REACHED",
        usage: finalChannelAccess.used,
        limit: finalChannelAccess.limit,
      });
      return;
    }

    await db
      .insert(menaWhatsAppConnections)
      .values({
        ownerId: existingConnection?.ownerId ?? ownerId,
        workspaceId,
        instanceName,
        phoneNumber,
        status: "connecting",
      })
      .onConflictDoUpdate({
        target: menaWhatsAppConnections.workspaceId,
        setWhere: eq(menaWhatsAppConnections.workspaceId, workspaceId),
        set: {
          instanceName,
          phoneNumber,
          status: "connecting",
        },
      });
    pairingInstanceName = instanceName;
    pairingAttemptPersisted = true;

    if (recreateInstance) {
      if (existingConnection && !existingInstanceMissing) {
        try {
          await evolutionRequest(
            `instance/delete/${encodeURIComponent(instanceName)}`,
            { method: "DELETE" },
          );
        } catch (err) {
          if (!(err instanceof EvolutionApiError && err.statusCode === 404)) {
            throw err;
          }
        }
      }
      await evolutionRequest("instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          number: evolutionPhoneNumber,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
          syncFullHistory: true,
        }),
      });
    } else if (evolutionState !== "connecting") {
      throw new EvolutionApiError(409, "WHATSAPP_INSTANCE_NOT_READY");
    }

    await configureWhatsAppWebhook(instanceName);
    const pairingPath = `instance/connect/${encodeURIComponent(instanceName)}?number=${encodeURIComponent(evolutionPhoneNumber)}`;
    let pairingResponse: unknown = null;
    let pairingCode: string | null = null;
    let pairingQrBase64: string | null = null;
    for (
      let attempt = 0;
      attempt < 3 &&
      !pairingCode;
      attempt += 1
    ) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      pairingResponse = await evolutionRequest(pairingPath);
      pairingCode = pairingCodeFrom(pairingResponse);
      pairingQrBase64 = pairingQrBase64From(pairingResponse);
    }
    if (!pairingCode) {
      const responseBody = asRecord(pairingResponse);
      console.error("Evolution API did not return a WhatsApp pairing code", {
        responseKeys: Object.keys(responseBody ?? {}),
        hasQrCode: Boolean(pairingQrBase64),
        count:
          typeof responseBody?.count === "number"
            ? responseBody.count
            : undefined,
      });
      throw new EvolutionApiError(
        422,
        "EVOLUTION_API_PAIRING_CODE_UNAVAILABLE",
      );
    }

    res.json({
      instanceName,
      phoneNumber,
      pairingCode,
      state: "connecting",
    });
  } catch (err) {
    if (pairingAttemptPersisted && pairingInstanceName) {
      try {
        await evolutionRequest(
          `instance/delete/${encodeURIComponent(pairingInstanceName)}`,
          { method: "DELETE" },
        );
      } catch (cleanupError) {
        if (
          !(cleanupError instanceof EvolutionApiError &&
            cleanupError.statusCode === 404)
        ) {
          console.error("Unable to clean failed WhatsApp pairing instance", {
            workspaceId,
            instanceName: pairingInstanceName,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : "UNKNOWN_ERROR",
          });
        }
      }
      try {
        await db
          .update(menaWhatsAppConnections)
          .set({ status: "failed" })
          .where(
            and(
              eq(menaWhatsAppConnections.workspaceId, workspaceId),
              eq(menaWhatsAppConnections.instanceName, pairingInstanceName),
              eq(menaWhatsAppConnections.status, "connecting"),
            ),
          );
      } catch (statusError) {
        console.error("Unable to mark WhatsApp pairing as failed", {
          workspaceId,
          instanceName: pairingInstanceName,
          error: statusError,
        });
      }
    }
    evolutionErrorResponse(res, err, "Error starting WhatsApp pairing");
  } finally {
    await unlockAndRelease?.();
  }
});

router.get(
  "/social/whatsapp/connection-status",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    const instanceName = queryString(req.query.instanceName);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    if (!instanceName) {
      res.status(400).json({ error: "اسم نسخة واتساب مطلوب." });
      return;
    }

    let connection: (typeof menaWhatsAppConnections.$inferSelect) | undefined;
    try {
      [connection] = await db
        .select()
        .from(menaWhatsAppConnections)
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
        .limit(1);
      if (!connection || connection.instanceName !== instanceName) {
        res.status(404).json({ error: "جلسة ربط واتساب غير موجودة." });
        return;
      }

      const providerState = await evolutionConnectionState(instanceName);
      const state = mapEvolutionConnectionState(
        providerState,
        connection.status === "failed",
      );
      if (state === "connected") {
        try {
          await configureWhatsAppWebhook(instanceName);
        } catch (err) {
          evolutionErrorResponse(
            res,
            err,
            "Error configuring WhatsApp message webhook",
          );
          return;
        }
        await db
          .update(menaWhatsAppConnections)
          .set({ status: "connected", connectedAt: new Date() })
          .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
        res.json({ state: "connected" });
        return;
      }

      if (state === "disconnected") {
        if (connection.status !== "disconnected") {
          await db
            .update(menaWhatsAppConnections)
            .set({ status: "disconnected" })
            .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
        }
        res.json({ state: "disconnected" });
        return;
      }

      if (state === "unavailable") {
        res.json({ state: "unavailable" });
        return;
      }

      if (state === "failed") {
        res.json({ state: "failed" });
        return;
      }

      if (connection.status === "connected") {
        await db
          .update(menaWhatsAppConnections)
          .set({ status: "connecting" })
          .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
      }
      res.json({ state: "connecting" });
    } catch (err) {
      if (connection?.status === "failed") {
        res.json({ state: "failed" });
        return;
      }
      evolutionErrorResponse(res, err, "Error checking WhatsApp connection");
    }
  },
);

router.get(
  "/social/whatsapp/group-selections",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    try {
      const [connection] = await db
        .select()
        .from(menaWhatsAppConnections)
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
        .limit(1);
      if (!connection) {
        res.status(404).json({ error: "حساب واتساب المرتبط غير موجود." });
        return;
      }

      const selections = await db
        .select({
          groupJid: menaWhatsAppGroupSelections.groupJid,
          groupId: menaWhatsAppGroups.id,
          kind: menaWhatsAppGroups.kind,
          name: menaWhatsAppGroupSelections.groupName,
          selected: menaWhatsAppGroupSelections.selected,
          verifiedAt: menaWhatsAppGroupSelections.verifiedAt,
        })
        .from(menaWhatsAppGroupSelections)
        .innerJoin(
          menaWhatsAppGroups,
          and(
            eq(menaWhatsAppGroups.id, menaWhatsAppGroupSelections.groupId),
            eq(menaWhatsAppGroups.workspaceId, workspaceId),
            eq(
              menaWhatsAppGroups.instanceName,
              connection.instanceName,
            ),
          ),
        )
        .where(
          and(
            eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
            eq(
              menaWhatsAppGroupSelections.instanceName,
              connection.instanceName,
            ),
            eq(menaWhatsAppGroupSelections.selected, true),
            eq(menaWhatsAppGroups.kind, "announcement"),
          ),
        );
      res.json({
        groups: selections.map((group) => ({
          groupJid: group.groupJid,
          groupId: group.groupId,
          kind: group.kind,
          name: group.name,
          selected: group.selected,
          verifiedAt: group.verifiedAt.toISOString(),
        })),
      });
    } catch (error) {
      console.error("Error fetching saved WhatsApp groups:", error);
      res.status(500).json({ error: "تعذر تحميل المجموعات المحفوظة." });
    }
  },
);

router.put(
  "/social/whatsapp/group-selections",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    const groupJids: unknown = req.body?.groupJids;
    if (
      !Array.isArray(groupJids) ||
      groupJids.some(
        (groupJid) =>
          typeof groupJid !== "string" ||
          !/^[0-9]+(?:-[0-9]+)?@g\.us$/.test(groupJid),
      ) ||
      new Set(groupJids).size !== groupJids.length
    ) {
      res.status(400).json({ error: "قائمة المجموعات المحددة غير صالحة." });
      return;
    }
    if (groupJids.length > MAX_WHATSAPP_GROUP_SELECTIONS) {
      res.status(400).json({
        error: "الحد الأقصى لاختيار مجموعات واتساب هو 500 مجموعة.",
      });
      return;
    }

    try {
      const connection = await connectedWhatsAppForWorkspace(workspaceId);
      const requestedJids = groupJids as string[];
      const selectedFromDirectory = requestedJids.length
        ? await db
            .select({
              groupId: menaWhatsAppGroups.id,
              groupJid: menaWhatsAppGroupJids.groupJid,
              kind: menaWhatsAppGroups.kind,
              name: menaWhatsAppGroups.name,
            })
            .from(menaWhatsAppGroupJids)
            .innerJoin(
              menaWhatsAppGroups,
              and(
                eq(menaWhatsAppGroups.id, menaWhatsAppGroupJids.groupId),
                eq(menaWhatsAppGroups.workspaceId, workspaceId),
                eq(menaWhatsAppGroups.instanceName, connection.instanceName),
              ),
            )
            .where(
              and(
                eq(menaWhatsAppGroupJids.workspaceId, workspaceId),
                eq(menaWhatsAppGroupJids.instanceName, connection.instanceName),
                inArray(menaWhatsAppGroupJids.groupJid, requestedJids),
                eq(menaWhatsAppGroupJids.kind, "announcement"),
                eq(menaWhatsAppGroups.kind, "announcement"),
              ),
            )
        : [];
      if (selectedFromDirectory.length !== requestedJids.length) {
        res.status(422).json({
          error:
            "تتضمن القائمة مجموعة إعلانات غير معروفة لهذا الحساب. حدّث القائمة ثم حاول مجدداً.",
        });
        return;
      }
      const groupByJid = new Map(
        selectedFromDirectory.map((group) => [group.groupJid, group]),
      );
      const selectedInRequestOrder = requestedJids.map((groupJid) =>
        groupByJid.get(groupJid)!,
      );

      const verifiedAt = new Date();
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${`whatsapp-group-selections:${workspaceId}:${connection.instanceName}`},
              0
            )
          )
        `);
        await transaction
          .delete(menaWhatsAppGroupSelections)
          .where(
            and(
              eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
              eq(
                menaWhatsAppGroupSelections.instanceName,
                connection.instanceName,
              ),
            ),
          );
        if (selectedInRequestOrder.length > 0) {
          await transaction.insert(menaWhatsAppGroupSelections).values(
            selectedInRequestOrder.map((group) => ({
              id: randomUUID(),
              ownerId: connection.ownerId,
              workspaceId: connection.workspaceId,
              instanceName: connection.instanceName,
              groupId: group.groupId,
              groupJid: group.groupJid,
              groupName: group.name,
              selected: true,
              canPublish: true,
              participantRole: "unknown",
              announcementOnly: true,
              participantCount: null,
              verifiedAt,
              updatedAt: verifiedAt,
            })),
          );
        }
      });

      res.json({
        groups: selectedInRequestOrder.map((group) => ({
          groupJid: group.groupJid,
          groupId: group.groupId,
          kind: group.kind,
          name: group.name,
          selected: true,
          verifiedAt: verifiedAt.toISOString(),
        })),
      });
    } catch (error) {
      if (error instanceof EvolutionApiError) {
        evolutionErrorResponse(res, error, "Error saving WhatsApp groups");
        return;
      }
      console.error("Error saving WhatsApp groups:", error);
      res.status(500).json({ error: "تعذر حفظ مجموعات واتساب المحددة." });
    }
  },
);

router.delete("/social/whatsapp", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  const cancelPairing = queryString(req.query.cancelPairing) === "true";
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection) {
      res.json({
        disconnected: true,
        alreadyDisconnected: true,
        evolutionInstanceDeleted: false,
      });
      return;
    }
    if (cancelPairing && connection.status !== "connecting") {
      res.json({ disconnected: false, evolutionInstanceDeleted: false });
      return;
    }
    const instanceConnections = await db
      .select({ ownerId: menaWhatsAppConnections.ownerId })
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.instanceName, connection.instanceName));
    if (
      !isExclusiveWhatsAppInstance(
        connection.ownerId,
        instanceConnections.map(
          ({ ownerId: connectionOwnerId }) => connectionOwnerId,
        ),
      )
    ) {
      res.status(409).json({
        error: "تعذر التحقق من ملكية جلسة واتساب. لم يتم حذف الاتصال.",
      });
      return;
    }

    if (cancelPairing) {
      let providerState: string | null = null;
      clearConnectionStateCache();
      try {
        providerState = await evolutionConnectionState(connection.instanceName);
      } catch (error) {
        if (!(error instanceof EvolutionApiError && error.statusCode === 404)) {
          throw error;
        }
      }
      if (providerState === "open") {
        await db
          .update(menaWhatsAppConnections)
          .set({ status: "connected" })
          .where(
            and(
              eq(menaWhatsAppConnections.workspaceId, workspaceId),
              eq(menaWhatsAppConnections.instanceName, connection.instanceName),
            ),
          );
        res.json({ disconnected: false, evolutionInstanceDeleted: false });
        return;
      }
    }

    let evolutionInstanceDeleted = true;
    try {
      await evolutionRequest(
        `instance/delete/${encodeURIComponent(connection.instanceName)}`,
        { method: "DELETE" },
      );
    } catch (err) {
      if (err instanceof EvolutionApiError && err.statusCode === 404) {
        evolutionInstanceDeleted = false;
      } else {
        throw err;
      }
    }

    if (cancelPairing) {
      const [cancelled] = await db
        .update(menaWhatsAppConnections)
        .set({ status: "failed" })
        .where(
          and(
            eq(menaWhatsAppConnections.workspaceId, workspaceId),
            eq(menaWhatsAppConnections.instanceName, connection.instanceName),
            eq(menaWhatsAppConnections.status, "connecting"),
          ),
        )
        .returning({ instanceName: menaWhatsAppConnections.instanceName });
      if (!cancelled) {
        res.status(409).json({
          error: "تغيرت حالة الربط أثناء الإلغاء. حدّث الصفحة للتحقق منها.",
        });
        return;
      }
      res.json({ disconnected: true, evolutionInstanceDeleted });
      return;
    }

    const deleted = await db
      .delete(menaWhatsAppConnections)
      .where(
        and(
          eq(menaWhatsAppConnections.workspaceId, workspaceId),
          eq(menaWhatsAppConnections.instanceName, connection.instanceName),
        ),
      )
      .returning({ ownerId: menaWhatsAppConnections.ownerId });
    if (deleted.length === 0) {
      const [latest] = await db
        .select({ instanceName: menaWhatsAppConnections.instanceName })
        .from(menaWhatsAppConnections)
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
        .limit(1);
      if (!latest) {
        res.json({
          disconnected: true,
          alreadyDisconnected: true,
          evolutionInstanceDeleted,
        });
        return;
      }
      res.status(409).json({
        error: "تغير اتصال واتساب أثناء الفصل. حدّث الصفحة للتحقق من حالته.",
      });
      return;
    }

    res.json({
      disconnected: true,
      evolutionInstanceDeleted,
    });
  } catch (err) {
    evolutionErrorResponse(res, err, "Error disconnecting WhatsApp");
  }
});

export default router;
