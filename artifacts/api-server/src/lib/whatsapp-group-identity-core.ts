import type { WhatsAppGroupKind } from "@workspace/db";
import type { WhatsAppGroup } from "./whatsapp-groups";

export interface GroupIdentityCandidate {
  groupJid: string;
  kind: WhatsAppGroupKind;
  name: string;
  parentJid?: string;
}

export function buildWhatsAppGroupIdentityCandidates(
  groups: readonly WhatsAppGroup[],
): GroupIdentityCandidate[] {
  const candidates = new Map<string, GroupIdentityCandidate>();
  for (const group of groups) {
    const candidate = {
      groupJid: group.groupJid,
      kind: group.kind,
      name: group.name,
      parentJid: group.communityParentJid,
    };
    const existing = candidates.get(group.groupJid);
    if (existing && existing.kind !== candidate.kind) {
      throw new Error("WHATSAPP_GROUP_IDENTITY_KIND_CONFLICT");
    }
    candidates.set(group.groupJid, candidate);
    if (group.communityParentJid) {
      const parent = candidates.get(group.communityParentJid);
      if (parent && parent.kind !== "community") {
        throw new Error("WHATSAPP_GROUP_PARENT_KIND_CONFLICT");
      }
      if (!parent) {
        candidates.set(group.communityParentJid, {
          groupJid: group.communityParentJid,
          kind: "community",
          name: "مجتمع واتساب",
        });
      }
    }
  }
  return [...candidates.values()];
}

export function resolveWhatsAppGroupSyncTargets<
  T extends { id: string; kind: WhatsAppGroupKind; parentGroupId: string | null },
>(selectedGroups: readonly T[], allGroups: readonly T[]): T[] {
  const targets = new Map<string, T>();
  for (const group of selectedGroups) {
    if (group.kind === "community") {
      for (const child of allGroups) {
        if (child.parentGroupId === group.id && child.kind === "announcement") {
          targets.set(child.id, child);
        }
      }
    } else if (group.kind === "announcement") {
      targets.set(group.id, group);
    }
  }
  return [...targets.values()];
}
