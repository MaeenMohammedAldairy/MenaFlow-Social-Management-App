// Pure mapper for the WhatsApp sync-status endpoint response.
//
// The sync panel on mobile gates the "sync now" button on the groups list
// returned by GET /social/whatsapp/sync-status. When that list was built
// from persisted sync states only, a workspace that had selected groups but
// never run a sync received an empty list — the button stayed disabled and
// the panel claimed "select at least one group" even though selections were
// saved. This mapper merges the selected group targets with their sync
// states so selected-but-never-synced groups appear with status "idle" and
// zero counters, which both enables the first sync and lets the client show
// its "groups are selected, start syncing" empty state.
//
// Keep this module dependency-free: it is unit-tested directly by
// whatsapp-sync-status.test.mjs under `node --experimental-strip-types`.

export type WhatsAppSyncStatusTarget = {
  id: string;
  name: string;
};

export type WhatsAppSyncStatusState = {
  groupId: string | null;
  groupJid: string;
  status: string;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type WhatsAppSyncStatusGroup = {
  groupJid: string;
  groupName: string;
  status: string;
  savedMessageCount: number;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export const IDLE_WHATSAPP_SYNC_STATUS = "idle";

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function buildWhatsAppSyncStatusGroups(input: {
  targets: readonly WhatsAppSyncStatusTarget[];
  states: readonly WhatsAppSyncStatusState[];
  groupJidByGroupId: ReadonlyMap<string, string>;
  savedMessageCountByGroupJid?: ReadonlyMap<string, number>;
}): WhatsAppSyncStatusGroup[] {
  const messageCounts =
    input.savedMessageCountByGroupJid ?? new Map<string, number>();
  const groups: WhatsAppSyncStatusGroup[] = [];
  const emittedJids = new Set<string>();

  for (const target of input.targets) {
    const state =
      input.states.find((candidate) => candidate.groupId === target.id) ??
      null;
    const groupJid =
      state?.groupJid ?? input.groupJidByGroupId.get(target.id);
    // A target without any known JID cannot be displayed or synced, and a
    // duplicated JID would render the same group twice.
    if (!groupJid || emittedJids.has(groupJid)) continue;
    emittedJids.add(groupJid);
    groups.push({
      groupJid,
      groupName: target.name,
      status: state?.status ?? IDLE_WHATSAPP_SYNC_STATUS,
      savedMessageCount: messageCounts.get(groupJid) ?? 0,
      importedCount: state?.importedCount ?? 0,
      skippedCount: state?.skippedCount ?? 0,
      failedCount: state?.failedCount ?? 0,
      lastSyncedAt: toIso(state?.lastSyncedAt),
      lastError: state?.lastError ?? null,
      startedAt: toIso(state?.startedAt),
      completedAt: toIso(state?.completedAt),
    });
  }

  return groups;
}
