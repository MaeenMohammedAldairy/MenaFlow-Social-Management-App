import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, menaWhatsAppConnections, menaWhatsAppGroupSelections } from "@workspace/db";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  EVOLUTION_GROUP_FETCH_TIMEOUT_MS,
  normalizeEvolutionGroups,
  type WhatsAppGroup,
} from "../lib/whatsapp-groups";
import {
  EvolutionApiError,
  evolutionRequest,
} from "../lib/whatsapp-evolution";
import { reconcileWhatsAppGroupDirectory } from "../lib/whatsapp-group-identity";
import { evolutionErrorResponse } from "./whatsapp-route-errors";

const router: IRouter = Router();

export async function connectedWhatsAppForWorkspace(workspaceId: string) {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.workspaceId, workspaceId))
    .limit(1);
  if (!connection) throw new EvolutionApiError(404, "WHATSAPP_CONNECTION_NOT_FOUND");
  if (connection.status !== "connected") {
    throw new EvolutionApiError(409, "WHATSAPP_CONNECTION_NOT_OPEN");
  }
  return connection;
}

export async function freshWhatsAppGroups(
  instanceName: string,
  signal?: AbortSignal,
): Promise<WhatsAppGroup[]> {
  const startedAt = performance.now();
  let phase = "request";
  try {
    const payload = await evolutionRequest(
      `group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
      { signal },
      EVOLUTION_GROUP_FETCH_TIMEOUT_MS,
    );
    const requestDurationMs = Math.round(performance.now() - startedAt);
    phase = "normalize";
    const normalizeStartedAt = performance.now();
    const groups = normalizeEvolutionGroups(payload);
    console.info("WhatsApp group directory fetched", {
      groupCount: groups.length,
      requestDurationMs,
      normalizeDurationMs: Math.round(performance.now() - normalizeStartedAt),
    });
    return groups;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("WhatsApp group directory fetch failed", {
      phase,
      durationMs: Math.round(performance.now() - startedAt),
      reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
    });
    if (error instanceof Error && error.message === "EVOLUTION_API_INVALID_GROUPS_RESPONSE") {
      throw new EvolutionApiError(502, error.message);
    }
    throw error;
  }
}

router.get("/social/whatsapp/groups", requireWorkspace, async (req, res) => {
  const workspaceId = requestWorkspaceId(req);
  const ownerId = requestOwnerId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const requestStartedAt = performance.now();
  const upstreamController = new AbortController();
  const abortUpstreamOnDisconnect = () => {
    if (!res.writableEnded) upstreamController.abort();
  };
  res.once("close", abortUpstreamOnDisconnect);
  try {
    const connection = await connectedWhatsAppForWorkspace(workspaceId);
    let selectionsReadDurationMs = 0;
    const selectionsPromise = (async () => {
      const selectionsStartedAt = performance.now();
      const selections = await db
        .select({
          groupId: menaWhatsAppGroupSelections.groupId,
          groupJid: menaWhatsAppGroupSelections.groupJid,
        })
        .from(menaWhatsAppGroupSelections)
        .where(
          and(
            eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
            eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
            eq(menaWhatsAppGroupSelections.selected, true),
          ),
        );
      selectionsReadDurationMs = Math.round(
        performance.now() - selectionsStartedAt,
      );
      return selections;
    })();
    const [groups, selections] = await Promise.all([
      freshWhatsAppGroups(connection.instanceName, upstreamController.signal),
      selectionsPromise,
    ]);
    await reconcileWhatsAppGroupDirectory(
      workspaceId,
      connection.ownerId,
      connection.instanceName,
      groups,
    );
    const selectedJids = new Set(
      selections.flatMap(({ groupJid }) => groupJid ? [groupJid] : []),
    );
    const selectedGroupIdsByJid = new Map(
      selections.flatMap(({ groupId, groupJid }) =>
        groupId && groupJid ? [[groupJid, groupId] as const] : [],
      ),
    );
    const responseGroups = groups.map((group) => {
      const groupId = selectedGroupIdsByJid.get(group.groupJid);
      return {
        ...group,
        ...(groupId ? { groupId } : {}),
        selected: selectedJids.has(group.groupJid),
      };
    });

    console.info("WhatsApp group directory response prepared", {
      groupCount: groups.length,
      selectedCount: selectedJids.size,
      selectionsReadDurationMs,
      totalDurationMs: Math.round(performance.now() - requestStartedAt),
    });
    res.json({
      groups: responseGroups,
    });
  } catch (error) {
    if (upstreamController.signal.aborted || res.destroyed) return;
    console.warn("WhatsApp group directory response failed", {
      totalDurationMs: Math.round(performance.now() - requestStartedAt),
      failureCode:
        error instanceof EvolutionApiError ? error.message : "INTERNAL_ERROR",
    });
    if (error instanceof EvolutionApiError) {
      evolutionErrorResponse(res, error, "Error fetching WhatsApp groups");
      return;
    }
    console.error("Error fetching WhatsApp groups:", error);
    res.status(500).json({ error: "تعذر تحميل مجموعات واتساب." });
  } finally {
    res.off("close", abortUpstreamOnDisconnect);
  }
});

export default router;
