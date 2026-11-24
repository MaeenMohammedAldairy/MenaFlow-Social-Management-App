import assert from "node:assert/strict";
import test from "node:test";
import {
  IDLE_WHATSAPP_SYNC_STATUS,
  buildWhatsAppSyncStatusGroups,
} from "./whatsapp-sync-status.ts";

const target = { id: "group-1", name: "متجر تك ستور" };
const jids = new Map([["group-1", "120363430177130458@g.us"]]);

test("selected groups without any sync state still appear as idle", () => {
  const groups = buildWhatsAppSyncStatusGroups({
    targets: [target],
    states: [],
    groupJidByGroupId: jids,
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], {
    groupJid: "120363430177130458@g.us",
    groupName: "متجر تك ستور",
    status: IDLE_WHATSAPP_SYNC_STATUS,
    savedMessageCount: 0,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastSyncedAt: null,
    lastError: null,
    startedAt: null,
    completedAt: null,
  });
});

test("groups with a sync state report the persisted state", () => {
  const startedAt = new Date("2026-11-24T01:39:00.000Z");
  const completedAt = new Date("2026-11-24T01:40:00.000Z");
  const lastSyncedAt = new Date("2026-11-24T01:40:00.000Z");
  const groups = buildWhatsAppSyncStatusGroups({
    targets: [target],
    states: [
      {
        groupId: "group-1",
        groupJid: "120363430177130458@g.us",
        status: "completed",
        importedCount: 12,
        skippedCount: 3,
        failedCount: 1,
        lastSyncedAt,
        lastError: null,
        startedAt,
        completedAt,
      },
    ],
    groupJidByGroupId: jids,
    savedMessageCountByGroupJid: new Map([
      ["120363430177130458@g.us", 15],
    ]),
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].status, "completed");
  assert.equal(groups[0].importedCount, 12);
  assert.equal(groups[0].skippedCount, 3);
  assert.equal(groups[0].failedCount, 1);
  assert.equal(groups[0].savedMessageCount, 15);
  assert.equal(groups[0].startedAt, "2026-11-24T01:39:00.000Z");
  assert.equal(groups[0].completedAt, "2026-11-24T01:40:00.000Z");
  assert.equal(groups[0].lastSyncedAt, "2026-11-24T01:40:00.000Z");
});

test("sync states of groups that are no longer selected are ignored", () => {
  const groups = buildWhatsAppSyncStatusGroups({
    targets: [target],
    states: [
      {
        groupId: "group-removed",
        groupJid: "120363999999999999@g.us",
        status: "completed",
        importedCount: 5,
        skippedCount: 0,
        failedCount: 0,
        lastSyncedAt: new Date("2026-11-24T01:00:00.000Z"),
        lastError: null,
        startedAt: null,
        completedAt: null,
      },
    ],
    groupJidByGroupId: jids,
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].groupJid, "120363430177130458@g.us");
  assert.equal(groups[0].status, IDLE_WHATSAPP_SYNC_STATUS);
});

test("targets without any known jid are skipped", () => {
  const groups = buildWhatsAppSyncStatusGroups({
    targets: [{ id: "group-unknown", name: "بلا معرف" }, target],
    states: [],
    groupJidByGroupId: jids,
  });
  assert.deepEqual(
    groups.map((group) => group.groupJid),
    ["120363430177130458@g.us"],
  );
});

test("webhook messages surface on idle groups before the first sync", () => {
  const groups = buildWhatsAppSyncStatusGroups({
    targets: [target],
    states: [],
    groupJidByGroupId: jids,
    savedMessageCountByGroupJid: new Map([
      ["120363430177130458@g.us", 4],
    ]),
  });
  assert.equal(groups[0].status, IDLE_WHATSAPP_SYNC_STATUS);
  assert.equal(groups[0].savedMessageCount, 4);
});

test("duplicate jids across targets render once", () => {
  const groups = buildWhatsAppSyncStatusGroups({
    targets: [target, { id: "group-2", name: "نفس المجموعة" }],
    states: [],
    groupJidByGroupId: new Map([
      ["group-1", "120363430177130458@g.us"],
      ["group-2", "120363430177130458@g.us"],
    ]),
  });
  assert.equal(groups.length, 1);
});
