import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  menaWhatsAppGroupJids,
  menaWhatsAppGroups,
  type WhatsAppGroupKind,
} from "@workspace/db";
import type { WhatsAppGroup } from "./whatsapp-groups";
import {
  buildWhatsAppGroupIdentityCandidates,
  type GroupIdentityCandidate,
} from "./whatsapp-group-identity-core";

export { resolveWhatsAppGroupSyncTargets } from "./whatsapp-group-identity-core";

export interface WhatsAppGroupIdentity {
  id: string;
  workspaceId: string;
  ownerId: string;
  instanceName: string;
  kind: WhatsAppGroupKind;
  name: string;
  parentGroupId: string | null;
  groupJid: string;
}

export async function reconcileWhatsAppGroupDirectory(
  workspaceId: string,
  ownerId: string,
  instanceName: string,
  groups: readonly WhatsAppGroup[],
): Promise<WhatsAppGroupIdentity[]> {
  const candidates = buildWhatsAppGroupIdentityCandidates(groups);
  if (candidates.length === 0) return [];
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`whatsapp-group-directory:${workspaceId}:${instanceName}`}, 0)
      )
    `);

    const existingRows = await transaction
      .select({
        id: menaWhatsAppGroups.id,
        workspaceId: menaWhatsAppGroups.workspaceId,
        ownerId: menaWhatsAppGroups.ownerId,
        instanceName: menaWhatsAppGroups.instanceName,
        kind: menaWhatsAppGroups.kind,
        name: menaWhatsAppGroups.name,
        parentGroupId: menaWhatsAppGroups.parentGroupId,
        groupJid: menaWhatsAppGroupJids.groupJid,
      })
      .from(menaWhatsAppGroupJids)
      .innerJoin(
        menaWhatsAppGroups,
        and(
          eq(menaWhatsAppGroups.id, menaWhatsAppGroupJids.groupId),
          eq(menaWhatsAppGroups.workspaceId, workspaceId),
          eq(menaWhatsAppGroups.instanceName, instanceName),
        ),
      )
      .where(
        and(
          eq(menaWhatsAppGroupJids.workspaceId, workspaceId),
          eq(menaWhatsAppGroupJids.instanceName, instanceName),
          inArray(
            menaWhatsAppGroupJids.groupJid,
            candidates.map((candidate) => candidate.groupJid),
          ),
        ),
      );
    const existingByJid = new Map(
      existingRows.map((identity) => [identity.groupJid, identity]),
    );
    const directoryIsCurrent =
      existingByJid.size === candidates.length &&
      candidates.every((candidate) => {
        const identity = existingByJid.get(candidate.groupJid);
        if (!identity) return false;
        const parentGroupId = candidate.parentJid
          ? existingByJid.get(candidate.parentJid)?.id
          : null;
        return (
          identity.kind === candidate.kind &&
          identity.name === candidate.name &&
          identity.parentGroupId === (parentGroupId ?? null)
        );
      });
    if (directoryIsCurrent) {
      return candidates.map((candidate) => existingByJid.get(candidate.groupJid)!);
    }

    if (existingByJid.size === 0) {
      const idByJid = new Map(
        candidates.map((candidate) => [candidate.groupJid, randomUUID()]),
      );
      const createdAt = new Date();
      await transaction.insert(menaWhatsAppGroups).values(
        candidates.map((candidate) => ({
          id: idByJid.get(candidate.groupJid)!,
          workspaceId,
          ownerId,
          instanceName,
          kind: candidate.kind,
          name: candidate.name,
          parentGroupId: candidate.parentJid
            ? idByJid.get(candidate.parentJid) ?? null
            : null,
          createdAt,
          updatedAt: createdAt,
        })),
      );
      await transaction.insert(menaWhatsAppGroupJids).values(
        candidates.map((candidate) => ({
          workspaceId,
          instanceName,
          groupJid: candidate.groupJid,
          groupId: idByJid.get(candidate.groupJid)!,
          kind: candidate.kind,
        })),
      );
      return candidates.map((candidate) => ({
        id: idByJid.get(candidate.groupJid)!,
        workspaceId,
        ownerId,
        instanceName,
        kind: candidate.kind,
        name: candidate.name,
        parentGroupId: candidate.parentJid
          ? idByJid.get(candidate.parentJid) ?? null
          : null,
        groupJid: candidate.groupJid,
      }));
    }

    const identities = new Map<string, WhatsAppGroupIdentity>();
    for (const candidate of candidates) {
      const [alias] = await transaction
        .select()
        .from(menaWhatsAppGroupJids)
        .where(
          and(
            eq(menaWhatsAppGroupJids.workspaceId, workspaceId),
            eq(menaWhatsAppGroupJids.instanceName, instanceName),
            eq(menaWhatsAppGroupJids.groupJid, candidate.groupJid),
          ),
        )
        .limit(1);
      let identity: WhatsAppGroupIdentity;
      if (alias) {
        const [updated] = await transaction
          .update(menaWhatsAppGroups)
          .set({
            kind: candidate.kind,
            name: candidate.name,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(menaWhatsAppGroups.id, alias.groupId),
              eq(menaWhatsAppGroups.workspaceId, workspaceId),
              eq(menaWhatsAppGroups.instanceName, instanceName),
            ),
          )
          .returning();
        if (!updated) throw new Error("WHATSAPP_GROUP_IDENTITY_NOT_FOUND");
        identity = { ...updated, groupJid: candidate.groupJid };
        await transaction
          .update(menaWhatsAppGroupJids)
          .set({ kind: candidate.kind, updatedAt: new Date() })
          .where(
            and(
              eq(menaWhatsAppGroupJids.workspaceId, workspaceId),
              eq(menaWhatsAppGroupJids.instanceName, instanceName),
              eq(menaWhatsAppGroupJids.groupJid, candidate.groupJid),
            ),
          );
      } else {
        const [created] = await transaction
          .insert(menaWhatsAppGroups)
          .values({
            id: randomUUID(),
            workspaceId,
            ownerId,
            instanceName,
            kind: candidate.kind,
            name: candidate.name,
          })
          .returning();
        if (!created) throw new Error("WHATSAPP_GROUP_IDENTITY_CREATE_FAILED");
        await transaction.insert(menaWhatsAppGroupJids).values({
          workspaceId,
          instanceName,
          groupJid: candidate.groupJid,
          groupId: created.id,
          kind: candidate.kind,
        });
        identity = { ...created, groupJid: candidate.groupJid };
      }
      identities.set(candidate.groupJid, identity);
    }

    for (const candidate of candidates) {
      const identity = identities.get(candidate.groupJid);
      if (!identity) throw new Error("WHATSAPP_GROUP_IDENTITY_CREATE_FAILED");
      const parentGroupId = candidate.parentJid
        ? identities.get(candidate.parentJid)?.id
        : null;
      if (candidate.parentJid && !parentGroupId) {
        throw new Error("WHATSAPP_GROUP_PARENT_IDENTITY_NOT_FOUND");
      }
      const [updated] = await transaction
        .update(menaWhatsAppGroups)
        .set({ parentGroupId, updatedAt: new Date() })
        .where(
          and(
            eq(menaWhatsAppGroups.id, identity.id),
            eq(menaWhatsAppGroups.workspaceId, workspaceId),
            eq(menaWhatsAppGroups.instanceName, instanceName),
          ),
        )
        .returning();
      if (!updated) throw new Error("WHATSAPP_GROUP_IDENTITY_NOT_FOUND");
      identities.set(candidate.groupJid, {
        ...updated,
        groupJid: candidate.groupJid,
      });
    }

    return [...identities.values()];
  });
}
