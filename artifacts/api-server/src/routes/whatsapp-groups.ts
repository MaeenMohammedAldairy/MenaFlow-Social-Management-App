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
import { reconcileWhatsAppGroupDirectory } from "../lib/whatsapp-group-identity";
import {
  EvolutionApiError,
  evolutionRequest,
} from "../lib/whatsapp-evolution";
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
): Promise<WhatsAppGroup[]> {
  const payload = await evolutionRequest(
    `group/fetchAllGroups/${encodeURIComponent(instanceName)}?getParticipants=false`,
    {},
    EVOLUTION_GROUP_FETCH_TIMEOUT_MS,
  );
  try {
    return normalizeEvolutionGroups(payload);
  } catch (error) {
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

  try {
    const connection = await connectedWhatsAppForWorkspace(workspaceId);
    const [groups, selections] = await Promise.all([
      freshWhatsAppGroups(connection.instanceName),
      db
        .select({ groupId: menaWhatsAppGroupSelections.groupId })
        .from(menaWhatsAppGroupSelections)
        .where(
          and(
            eq(menaWhatsAppGroupSelections.workspaceId, workspaceId),
            eq(menaWhatsAppGroupSelections.instanceName, connection.instanceName),
            eq(menaWhatsAppGroupSelections.selected, true),
          ),
        ),
    ]);
    const identities = await reconcileWhatsAppGroupDirectory(
      workspaceId,
      connection.ownerId,
      connection.instanceName,
      groups,
    );
    const identityByJid = new Map(
      identities.map((identity) => [identity.groupJid, identity]),
    );
    const selectedIds = new Set(
      selections.flatMap(({ groupId }) => groupId ? [groupId] : []),
    );
    const responseGroups = groups.map((group) => {
      const identity = identityByJid.get(group.groupJid);
      if (!identity) throw new Error("WHATSAPP_GROUP_IDENTITY_NOT_FOUND");
      return {
        ...group,
        groupId: identity.id,
        selected: selectedIds.has(identity.id),
      };
    });

    res.json({
      groups: responseGroups,
    });
  } catch (error) {
    if (error instanceof EvolutionApiError) {
      evolutionErrorResponse(res, error, "Error fetching WhatsApp groups");
      return;
    }
    console.error("Error fetching WhatsApp groups:", error);
    res.status(500).json({ error: "تعذر تحميل مجموعات واتساب." });
  }
});

export default router;
