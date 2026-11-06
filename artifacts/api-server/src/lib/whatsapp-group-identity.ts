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

    const identityByJid = new Map(
      candidates.map((candidate) => {
        const existing = existingByJid.get(candidate.groupJid);
        return [
          candidate.groupJid,
          {
            id: existing?.id ?? randomUUID(),
            workspaceId,
            ownerId,
            instanceName,
            kind: candidate.kind,
            name: candidate.name,
            parentGroupId: null,
            groupJid: candidate.groupJid,
          },
        ] as const;
      }),
    );
    const missingCandidates = candidates.filter(
      (candidate) => !existingByJid.has(candidate.groupJid),
    );
    const now = new Date();
    if (missingCandidates.length > 0) {
      await transaction.insert(menaWhatsAppGroups).values(
        missingCandidates.map((candidate) => ({
          id: identityByJid.get(candidate.groupJid)!.id,
          workspaceId,
          ownerId,
          instanceName,
          kind: candidate.kind,
          name: candidate.name,
          createdAt: now,
          updatedAt: now,
        })),
      );
      await transaction.insert(menaWhatsAppGroupJids).values(
        missingCandidates.map((candidate) => ({
          workspaceId,
          instanceName,
          groupJid: candidate.groupJid,
          groupId: identityByJid.get(candidate.groupJid)!.id,
          kind: candidate.kind,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const kindCases = candidates.map((candidate) => {
      const identity = identityByJid.get(candidate.groupJid);
      if (!identity) throw new Error("WHATSAPP_GROUP_IDENTITY_CREATE_FAILED");
      return sql`WHEN ${identity.id} THEN ${candidate.kind}`;
    });
    const nameCases = candidates.map((candidate) => {
      const identity = identityByJid.get(candidate.groupJid);
      if (!identity) throw new Error("WHATSAPP_GROUP_IDENTITY_CREATE_FAILED");
      return sql`WHEN ${identity.id} THEN ${candidate.name}`;
    });
    const parentCases = candidates.map((candidate) => {
      const identity = identityByJid.get(candidate.groupJid);
      if (!identity) throw new Error("WHATSAPP_GROUP_IDENTITY_CREATE_FAILED");
      const parentGroupId = candidate.parentJid
        ? identityByJid.get(candidate.parentJid)?.id
        : null;
      if (candidate.parentJid && !parentGroupId) {
        throw new Error("WHATSAPP_GROUP_PARENT_IDENTITY_NOT_FOUND");
      }
      return sql`WHEN ${identity.id} THEN ${parentGroupId}`;
    });
    const groupIds = [...identityByJid.values()].map(({ id }) => id);
    const updatedGroups = await transaction
      .update(menaWhatsAppGroups)
      .set({
        kind: sql`CASE ${menaWhatsAppGroups.id} ${sql.join(kindCases, sql` `)} ELSE ${menaWhatsAppGroups.kind} END`,
        name: sql`CASE ${menaWhatsAppGroups.id} ${sql.join(nameCases, sql` `)} ELSE ${menaWhatsAppGroups.name} END`,
        parentGroupId: sql`CASE ${menaWhatsAppGroups.id} ${sql.join(parentCases, sql` `)} ELSE ${menaWhatsAppGroups.parentGroupId} END`,
        updatedAt: now,
      })
      .where(
        and(
          eq(menaWhatsAppGroups.workspaceId, workspaceId),
          eq(menaWhatsAppGroups.instanceName, instanceName),
          inArray(menaWhatsAppGroups.id, groupIds),
        ),
      )
      .returning({ id: menaWhatsAppGroups.id });
    if (updatedGroups.length !== candidates.length) {
      throw new Error("WHATSAPP_GROUP_IDENTITY_NOT_FOUND");
    }

    const jidCases = candidates.map(
      (candidate) => sql`WHEN ${candidate.groupJid} THEN ${candidate.kind}`,
    );
    await transaction
      .update(menaWhatsAppGroupJids)
      .set({
        kind: sql`CASE ${menaWhatsAppGroupJids.groupJid} ${sql.join(jidCases, sql` `)} ELSE ${menaWhatsAppGroupJids.kind} END`,
        updatedAt: now,
      })
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

    return candidates.map((candidate) => {
      const identity = identityByJid.get(candidate.groupJid);
      if (!identity) throw new Error("WHATSAPP_GROUP_IDENTITY_CREATE_FAILED");
      return {
        ...identity,
        parentGroupId: candidate.parentJid
          ? (identityByJid.get(candidate.parentJid)?.id ?? null)
          : null,
      };
    });
  });
}
