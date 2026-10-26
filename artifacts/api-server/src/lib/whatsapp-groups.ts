export type WhatsAppGroupKind =
  | "community"
  | "announcement"
  | "group"
  | "unknown";

export const EVOLUTION_GROUP_FETCH_TIMEOUT_MS = 60_000;

export interface WhatsAppGroup {
  groupJid: string;
  kind: WhatsAppGroupKind;
  name: string;
  communityParentJid?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return null;
}

export function normalizeEvolutionGroups(
  payload: unknown,
): WhatsAppGroup[] {
  const body = record(payload);
  const data = record(body?.data);
  const directGroups = Array.isArray(payload) ? payload : null;
  const bodyGroups = Array.isArray(body?.groups) ? body.groups : null;
  const bodyDataGroups = Array.isArray(body?.data) ? body.data : null;
  const nestedDataGroups = Array.isArray(data?.groups) ? data.groups : null;
  const groups: unknown[] | null =
    directGroups ?? bodyGroups ?? bodyDataGroups ?? nestedDataGroups ?? null;
  if (!groups) throw new Error("EVOLUTION_API_INVALID_GROUPS_RESPONSE");

  return groups.flatMap((entry: unknown): WhatsAppGroup[] => {
    const group = record(entry);
    if (typeof group?.id !== "string" || !/^[0-9]+(?:-[0-9]+)?@g\.us$/.test(group.id)) {
      return [];
    }
    const announce = asBoolean(group.announce);
    const isCommunity = asBoolean(group.isCommunity) === true;
    if (isCommunity || announce !== true) return [];
    const communityParentJid =
      typeof group.linkedParent === "string" && group.linkedParent.trim()
        ? group.linkedParent.trim()
        : undefined;
    return [{
      groupJid: group.id,
      kind: "announcement",
      name: typeof group.subject === "string" && group.subject.trim()
        ? group.subject.trim()
        : typeof group.name === "string" && group.name.trim()
          ? group.name.trim()
        : "مجموعة بدون اسم",
      communityParentJid,
    }];
  });
}

export function selectEvolutionGroups(
  groups: readonly WhatsAppGroup[],
  groupJids: readonly string[],
): WhatsAppGroup[] | undefined {
  const groupsByJid = new Map(groups.map((group) => [group.groupJid, group]));
  const selectedGroups: WhatsAppGroup[] = [];
  for (const groupJid of groupJids) {
    const group = groupsByJid.get(groupJid);
    if (!group || group.kind !== "announcement") return undefined;
    selectedGroups.push(group);
  }

  return selectedGroups;
}
