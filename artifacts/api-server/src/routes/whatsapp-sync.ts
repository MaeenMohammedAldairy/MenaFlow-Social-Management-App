import { and, eq, inArray, ne, sql } from "drizzle-orm";

import {
  db,
  menaWhatsAppConnections,
  menaWhatsAppGroups,
  menaWhatsAppGroupJids,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessages,
  menaWhatsAppSyncStates,
} from "@workspace/db";

import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

import { verifyWhatsAppWebhookSecret } from "../lib/whatsapp-evolution";
import { resolveWhatsAppGroupSyncTargets } from "../lib/whatsapp-group-identity";
import { hasEnabledWhatsAppSyncType } from "../lib/whatsapp-sync-options";

import {
  ensureSyncState,
  updateSyncState,
  cancelStaleWhatsAppSyncs,
  syncGroupHistory,
  processWebhookEvent,
  WHATSAPP_SYNC_STALE_THRESHOLD_MS,
  DEFAULT_WHATSAPP_HISTORY_IMPORT_LIMIT,
  MAX_WHATSAPP_HISTORY_IMPORT_LIMIT,
} from "../lib/whatsapp-sync";

const router: IRouter = Router();
const syncSettingKeys = [
  "autoSyncEnabled",
  "syncMessagesEnabled",
  "syncImagesEnabled",
  "syncVideosEnabled",
] as const;

router.post("/social/whatsapp/sync-now", requireWorkspace, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const includeHistory = req.body?.includeHistory !== false;
  const requestedHistoryLimit = req.body?.historyLimit;
  if (
    includeHistory &&
    requestedHistoryLimit !== undefined &&
    (typeof requestedHistoryLimit !== "number" ||
      !Number.isInteger(requestedHistoryLimit) ||
      requestedHistoryLimit < 1 ||
      requestedHistoryLimit > MAX_WHATSAPP_HISTORY_IMPORT_LIMIT)
  ) {
    res.status(400).json({
      error: `عدد الرسائل السابقة يجب أن يكون بين 1 و${MAX_WHATSAPP_HISTORY_IMPORT_LIMIT}.`,
    });
    return;
  }
  const historyLimit =
    includeHistory && typeof requestedHistoryLimit === "number"
      ? requestedHistoryLimit
      : DEFAULT_WHATSAPP_HISTORY_IMPORT_LIMIT;

  try {
    const [connection] = await db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
      .limit(1);
    if (!connection) {
      res.status(404).json({ error: "حساب واتساب غير موجود." });
      return;
    }
    if (!hasEnabledWhatsAppSyncType(connection)) {
      res.status(200).json({ status: "no_sync_options", groups: [] });
      return;
    }
    await cancelStaleWhatsAppSyncs(workspaceId, connection.instanceName);
    const groups = await db
      .select()
      .from(menaWhatsAppGroupSelections)
      .where(
        and(
          eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
          eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      );

    if (groups.length === 0) {
      res.status(200).json({ status: "no_selected_groups", groups: [] });
      return;
    }
    if (groups.some((group) => !group.groupId)) {
      res.status(409).json({
        error:
          "توجد اختيارات قديمة بلا هوية مجموعة مؤكدة. شغّل تقرير ترحيل الهوية وراجع السجلات قبل المزامنة.",
      });
      return;
    }

    const selectedGroups = await db
      .select({
        id: menaWhatsAppGroups.id,
        kind: menaWhatsAppGroups.kind,
        parentGroupId: menaWhatsAppGroups.parentGroupId,
        name: menaWhatsAppGroupSelections.groupName,
      })
      .from(menaWhatsAppGroupSelections)
      .innerJoin(
        menaWhatsAppGroups,
        and(
          eq(menaWhatsAppGroups.id, menaWhatsAppGroupSelections.groupId),
          eq(menaWhatsAppGroups.workspaceId, workspaceId),
          eq(menaWhatsAppGroups.instanceName, connection.instanceName),
        ),
      )
      .where(
        and(
          eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
          eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
          eq(menaWhatsAppGroupSelections.selected, true),
        ),
      );
    if (selectedGroups.length !== groups.length) {
      res.status(409).json({
        error:
          "تعذر مطابقة كل الاختيارات مع هوية المجموعة ضمن اتصال واتساب الحالي.",
      });
      return;
    }
    const allGroups = await db
      .select({
        id: menaWhatsAppGroups.id,
        kind: menaWhatsAppGroups.kind,
        parentGroupId: menaWhatsAppGroups.parentGroupId,
        name: menaWhatsAppGroups.name,
      })
      .from(menaWhatsAppGroups)
      .where(
        and(
          eq(menaWhatsAppGroups.workspaceId, workspaceId),
          eq(menaWhatsAppGroups.instanceName, connection.instanceName),
        ),
      );
    const syncTargets = resolveWhatsAppGroupSyncTargets(
      selectedGroups,
      allGroups,
    );
    if (syncTargets.length === 0) {
      res.status(200).json({
        status: "no_linked_announcement_groups",
        groups: [],
      });
      return;
    }
    const targetIds = syncTargets.map(({ id }) => id);
    const targetJids = await db
      .select({
        groupId: menaWhatsAppGroupJids.groupId,
        groupJid: menaWhatsAppGroupJids.groupJid,
      })
      .from(menaWhatsAppGroupJids)
      .where(
        and(
          eq(menaWhatsAppGroupJids.workspaceId, workspaceId),
          eq(menaWhatsAppGroupJids.instanceName, connection.instanceName),
          inArray(menaWhatsAppGroupJids.groupId, targetIds),
        ),
      );
    const jidByGroupId = new Map(
      targetJids.map(({ groupId, groupJid }) => [groupId, groupJid]),
    );
    const syncGroups = syncTargets.flatMap((group) => {
      const groupJid = jidByGroupId.get(group.id);
      return groupJid ? [{ ...group, groupJid }] : [];
    });
    if (syncGroups.length !== syncTargets.length) {
      throw new Error("WHATSAPP_GROUP_IDENTITY_JID_MISSING");
    }

    const syncStartedAt = new Date();
    for (const group of syncGroups) {
      await ensureSyncState(
        workspaceId,
        connection.instanceName,
        group.groupJid,
        group.id,
      );
    }
    const claimedStates = await db
      .update(menaWhatsAppSyncStates)
      .set({
        status: "running",
        startedAt: syncStartedAt,
        completedAt: null,
        lastError: null,
        importedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedAt: syncStartedAt,
      })
      .where(
        and(
          eq(menaWhatsAppSyncStates.workspaceId, workspaceId),
          eq(menaWhatsAppSyncStates.instanceName, connection.instanceName),
          ne(menaWhatsAppSyncStates.status, "running"),
          inArray(
            menaWhatsAppSyncStates.groupId,
            syncGroups.map((group) => group.id),
          ),
        ),
      )
      .returning({ groupId: menaWhatsAppSyncStates.groupId });
    const claimedGroupIds = new Set(
      claimedStates.flatMap(({ groupId }) => (groupId ? [groupId] : [])),
    );
    const claimedGroups = syncGroups.filter((group) =>
      claimedGroupIds.has(group.id),
    );
    if (claimedGroups.length === 0) {
      res.status(200).json({
        status: "already_running",
        groups: syncGroups.map((group) => ({
          groupJid: group.groupJid,
          groupName: group.name,
        })),
      });
      return;
    }

    void Promise.all(
      claimedGroups.map(async (group) => {
        try {
          await syncGroupHistory(
            workspaceId,
            connection.instanceName,
            group.groupJid,
            group.name,
            group.id,
            includeHistory,
            false,
            historyLimit,
          );
        } catch (error) {
          const reason =
            error instanceof Error
              ? error.message.slice(0, 160)
              : "WHATSAPP_HISTORY_SYNC_FAILED";
          console.error("WhatsApp historical sync failed before processing", {
            workspaceId,
            instanceName: connection.instanceName,
            groupJid: group.groupJid,
            reason,
          });
          try {
            await ensureSyncState(
              workspaceId,
              connection.instanceName,
              group.groupJid,
              group.id,
            );
            await updateSyncState(
              workspaceId,
              connection.instanceName,
              group.groupJid,
              group.id,
              {
                status: "failed",
                lastError: reason,
                failedCount: 1,
                completedAt: new Date(),
              },
            );
          } catch (stateError) {
            console.error(
              "Could not persist WhatsApp historical sync failure",
              {
                workspaceId,
                instanceName: connection.instanceName,
                groupJid: group.groupJid,
                reason:
                  stateError instanceof Error
                    ? stateError.message.slice(0, 160)
                    : "SYNC_STATE_UPDATE_FAILED",
              },
            );
          }
        }
      }),
    ).catch((error: unknown) => {
      console.error("WhatsApp historical sync task batch failed", {
        workspaceId,
        reason:
          error instanceof Error
            ? error.message.slice(0, 160)
            : "SYNC_BATCH_FAILED",
      });
    });

    res.status(202).json({
      status: "started",
      includeHistory,
      groups: syncGroups.map((group) => ({
        groupJid: group.groupJid,
        groupName: group.name,
      })),
    });
  } catch (error) {
    console.error("Error starting WhatsApp sync:", error);
    res.status(500).json({ error: "تعذر بدء مزامنة واتساب." });
  }
});

router.get(
  "/social/whatsapp/sync-status",
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
        res.status(404).json({ error: "حساب واتساب غير موجود." });
        return;
      }

      let [states, selections, allGroups] = await Promise.all([
        db
          .select()
          .from(menaWhatsAppSyncStates)
          .where(
            and(
              eq(menaWhatsAppSyncStates.workspaceId, workspaceId),
              eq(menaWhatsAppSyncStates.instanceName, connection.instanceName),
            ),
          ),
        db
          .select({
            groupId: menaWhatsAppGroupSelections.groupId,
          })
          .from(menaWhatsAppGroupSelections)
          .where(
            and(
              eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
              eq(
                menaWhatsAppGroupSelections.instanceName,
                connection.instanceName,
              ),
              eq(menaWhatsAppGroupSelections.selected, true),
            ),
          ),
        db
          .select({
            id: menaWhatsAppGroups.id,
            kind: menaWhatsAppGroups.kind,
            parentGroupId: menaWhatsAppGroups.parentGroupId,
            name: menaWhatsAppGroups.name,
          })
          .from(menaWhatsAppGroups)
          .where(
            and(
              eq(menaWhatsAppGroups.workspaceId, workspaceId),
              eq(menaWhatsAppGroups.instanceName, connection.instanceName),
            ),
          ),
      ]);
      if (
        states.some(
          (state) =>
            state.status === "running" &&
            Date.now() - state.updatedAt.getTime() >=
              WHATSAPP_SYNC_STALE_THRESHOLD_MS,
        )
      ) {
        await cancelStaleWhatsAppSyncs(workspaceId, connection.instanceName);
        states = await db
          .select()
          .from(menaWhatsAppSyncStates)
          .where(
            and(
              eq(menaWhatsAppSyncStates.workspaceId, workspaceId),
              eq(menaWhatsAppSyncStates.instanceName, connection.instanceName),
            ),
          );
      }
      const groupsById = new Map(allGroups.map((group) => [group.id, group]));
      const selectedGroups = resolveWhatsAppGroupSyncTargets(
        selections.flatMap(({ groupId }) => {
          const group = groupId ? groupsById.get(groupId) : undefined;
          return group ? [group] : [];
        }),
        allGroups,
      );
      const selectedGroupIds = new Set(selectedGroups.map(({ id }) => id));
      const groupNames = new Map(
        selectedGroups.map(({ id, name }) => [id, name]),
      );
      const selectedSyncStates = states.filter(
        (state) => state.groupId && selectedGroupIds.has(state.groupId),
      );
      const selectedGroupJids = selectedSyncStates.map(
        (state) => state.groupJid,
      );
      const savedMessageCounts =
        selectedGroupJids.length > 0
          ? await db
              .select({
                groupJid: menaWhatsAppMessages.groupJid,
                count: sql<number>`count(*)::int`,
              })
              .from(menaWhatsAppMessages)
              .where(
                and(
                  eq(menaWhatsAppMessages.workspaceId, workspaceId),
                  eq(
                    menaWhatsAppMessages.instanceName,
                    connection.instanceName,
                  ),
                  inArray(menaWhatsAppMessages.groupJid, selectedGroupJids),
                ),
              )
              .groupBy(menaWhatsAppMessages.groupJid)
          : [];
      const savedMessageCountByGroupJid = new Map(
        savedMessageCounts.map(({ groupJid, count }) => [groupJid, count]),
      );

      res.json({
        autoSyncEnabled: connection.autoSyncEnabled,
        syncMessagesEnabled: connection.syncMessagesEnabled,
        syncImagesEnabled: connection.syncImagesEnabled,
        syncVideosEnabled: connection.syncVideosEnabled,
        groups: selectedSyncStates.map((state) => ({
          groupJid: state.groupJid,
          groupName: state.groupId
            ? (groupNames.get(state.groupId) ?? state.groupJid)
            : state.groupJid,
          status: state.status,
          savedMessageCount:
            savedMessageCountByGroupJid.get(state.groupJid) ?? 0,
          importedCount: state.importedCount,
          skippedCount: state.skippedCount,
          failedCount: state.failedCount,
          lastSyncedAt: state.lastSyncedAt?.toISOString() ?? null,
          lastError: state.lastError,
          startedAt: state.startedAt?.toISOString() ?? null,
          completedAt: state.completedAt?.toISOString() ?? null,
        })),
      });
    } catch (error) {
      console.error("Error fetching WhatsApp sync status:", error);
      res.status(500).json({ error: "تعذر جلب حالة المزامنة." });
    }
  },
);

router.put(
  "/social/whatsapp/sync-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }

    if (
      typeof req.body !== "object" ||
      req.body === null ||
      Array.isArray(req.body)
    ) {
      res.status(400).json({ error: "إعدادات مزامنة واتساب غير صالحة." });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const allowedSettings = new Set<string>(syncSettingKeys);
    const hasUnknownSetting = Object.keys(body).some(
      (key) => !allowedSettings.has(key),
    );
    if (hasUnknownSetting || Object.keys(body).length === 0) {
      res.status(400).json({ error: "إعدادات مزامنة واتساب غير صالحة." });
      return;
    }
    const settings: Partial<Record<(typeof syncSettingKeys)[number], boolean>> =
      {};
    for (const key of syncSettingKeys) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const value = body[key];
      if (typeof value !== "boolean") {
        res.status(400).json({ error: "إعدادات مزامنة واتساب غير صالحة." });
        return;
      }
      settings[key] = value;
    }

    try {
      const updated = await db
        .update(menaWhatsAppConnections)
        .set(settings)
        .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
        .returning({
          autoSyncEnabled: menaWhatsAppConnections.autoSyncEnabled,
          syncMessagesEnabled: menaWhatsAppConnections.syncMessagesEnabled,
          syncImagesEnabled: menaWhatsAppConnections.syncImagesEnabled,
          syncVideosEnabled: menaWhatsAppConnections.syncVideosEnabled,
        });
      const [connection] = updated;
      if (!connection) {
        res.status(404).json({ error: "حساب واتساب غير موجود." });
        return;
      }

      res.json(connection);
    } catch (error) {
      console.error("Error updating WhatsApp sync settings:", error);
      res.status(500).json({ error: "تعذر حفظ إعداد المزامنة التلقائية." });
    }
  },
);

router.post("/social/whatsapp/webhook", async (req, res) => {
  if (!verifyWhatsAppWebhookSecret(req.headers["x-evolution-api-key"])) {
    res.status(401).json({ ok: false });
    return;
  }
  const body = req.body ?? {};
  try {
    await processWebhookEvent(body, {
      headers: req.headers as Record<string, string | string[] | undefined>,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Evolution webhook processing failed:", error);
    res.status(500).json({ ok: false });
  }
});

export default router;
