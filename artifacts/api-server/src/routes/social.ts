import { and, eq, inArray } from "drizzle-orm";

import {
  db,
  pool,
  menaMetaConnections,
  menaWhatsAppConnections,
  menaWhatsAppGroups,
  menaWhatsAppGroupJids,
  menaWhatsAppGroupSelections,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { missingMetaIntegrationPermissions } from "../lib/meta-oauth";
import {
  filterHistoryRecordsForGroup,
  extractRemoteJidFromEnvelope,
} from "../lib/whatsapp-message-scope";

import {
  configureWhatsAppWebhook,
  EvolutionApiError,
  evolutionConnectionState,
  evolutionRequest,
  isExclusiveWhatsAppInstance,
} from "../lib/whatsapp-evolution";

import { whatsappInstanceNameForWorkspace } from "../lib/whatsapp-instance";

import {
  connectedWhatsAppForWorkspace,
} from "./whatsapp-groups";
import { evolutionErrorResponse } from "./whatsapp-route-errors";
import { asRecord, queryString } from "../lib/whatsapp-route-utils";

import { pairingCodeFrom, pairingQrBase64From } from "../lib/whatsapp-pairing";

const router: IRouter = Router();

export { extractRemoteJidFromEnvelope, filterHistoryRecordsForGroup };

function metaAuthorizationStatus(
  connection: typeof menaMetaConnections.$inferSelect,
  integration: "facebook" | "instagram",
  now = new Date(),
) {
  const missingPermissions = connection.authorizationVerifiedAt
    ? missingMetaIntegrationPermissions(
        integration,
        connection.grantedPermissions,
      )
    : [];
  const tokenExpired =
    connection.accessTokenExpiresAt !== null &&
    connection.accessTokenExpiresAt <= now;
  const authorizationReason = tokenExpired
    ? "token_expired"
    : !connection.authorizationVerifiedAt
      ? "permissions_unverified"
      : missingPermissions.length > 0
        ? "permissions_missing"
        : null;

  return {
    authorizationStatus: authorizationReason
      ? "needs_reauthorization"
      : "ready",
    authorizationReason,
    missingPermissions,
    accessTokenExpiresAt:
      connection.accessTokenExpiresAt?.toISOString() ?? null,
  };
}

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

  const [waConnection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
    .limit(1);

  let whatsappState:
    | "connected"
    | "connecting"
    | "disconnected"
    | "missing"
    | "unavailable"
    | null = null;
  if (waConnection) {
    try {
      const providerState = await evolutionConnectionState(
        waConnection.instanceName,
      );
      whatsappState =
        providerState === "open"
          ? "connected"
          : providerState === "connecting"
            ? "connecting"
            : ["close", "closed", "refused", "logout"].includes(providerState)
              ? "disconnected"
              : "unavailable";
    } catch (err) {
      if (err instanceof EvolutionApiError && err.statusCode === 404) {
        whatsappState = "missing";
      } else {
        console.warn("Unable to verify WhatsApp connection state", {
          workspaceId,
          statusCode: err instanceof EvolutionApiError ? err.statusCode : null,
        });
        whatsappState = "unavailable";
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
          ...metaAuthorizationStatus(connection, "facebook"),
        }
      : null,
    instagram:
      connection?.instagramUserId && connection.instagramUsername
        ? {
            accountId: connection.instagramUserId,
            accountName: connection.instagramUsername,
            connectedAt: connection.connectedAt.toISOString(),
            ...metaAuthorizationStatus(connection, "instagram"),
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

  const refreshCode = req.body?.refreshCode === true;
  let unlockAndRelease: (() => Promise<void>) | null = null;
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
          integration: "WHATSAPP-BAILEYS",
          qrcode: false,
          syncFullHistory: true,
        }),
      });
    } else if (evolutionState !== "connecting") {
      throw new EvolutionApiError(409, "WHATSAPP_INSTANCE_NOT_READY");
    }

    await configureWhatsAppWebhook(instanceName);
    const pairingPath = `instance/connect/${encodeURIComponent(instanceName)}?number=${encodeURIComponent(phoneNumber.replace(/^\+/, ""))}`;
    let pairingResponse: unknown = null;
    let pairingCode: string | null = null;
    let pairingQrBase64: string | null = null;
    for (let attempt = 0; attempt < 3 && !pairingCode; attempt += 1) {
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
      ...(pairingQrBase64 ? { qrCodeBase64: pairingQrBase64 } : {}),
      state: "connecting",
    });
  } catch (err) {
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

    try {
      const [connection] = await db
        .select()
        .from(menaWhatsAppConnections)
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
        .limit(1);
      if (!connection || connection.instanceName !== instanceName) {
        res.status(404).json({ error: "جلسة ربط واتساب غير موجودة." });
        return;
      }

      const state = await evolutionConnectionState(instanceName);
      if (state === "open") {
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

      if (["close", "closed", "refused", "logout"].includes(state)) {
        if (connection.status !== "disconnected") {
          await db
            .update(menaWhatsAppConnections)
            .set({ status: "disconnected" })
            .where(eq(menaWhatsAppConnections.workspaceId, workspaceId));
        }
        res.json({ state: "disconnected" });
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
      groupJids.length > 500 ||
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

    try {
      const connection = await connectedWhatsAppForWorkspace(workspaceId);
      const requestedJids = groupJids as string[];
      const selectedGroups = requestedJids.length
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
                eq(
                  menaWhatsAppGroups.instanceName,
                  connection.instanceName,
                ),
              ),
            )
            .where(
              and(
                eq(menaWhatsAppGroupJids.workspaceId, workspaceId),
                eq(
                  menaWhatsAppGroupJids.instanceName,
                  connection.instanceName,
                ),
                inArray(menaWhatsAppGroupJids.groupJid, requestedJids),
                eq(menaWhatsAppGroups.kind, "announcement"),
              ),
            )
        : [];

      if (selectedGroups.length !== requestedJids.length) {
        res.status(422).json({
          error:
            "تتضمن القائمة مجموعة إعلانات غير معروفة لهذا الحساب. حدّث القائمة ثم حاول مجدداً.",
        });
        return;
      }
      const groupByJid = new Map(
        selectedGroups.map((group) => [group.groupJid, group]),
      );
      const selectedInRequestOrder = requestedJids.map((groupJid) =>
        groupByJid.get(groupJid)!,
      );

      const verifiedAt = new Date();
      await db.transaction(async (transaction) => {
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
