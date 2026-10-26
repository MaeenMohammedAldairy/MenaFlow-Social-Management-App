import assert from "node:assert/strict";
import test from "node:test";
import { planWhatsAppGroupIdentityBackfill } from "./whatsapp-group-identity-migration.mjs";

const connections = [
  { workspace_id: "workspace-a", owner_id: "owner-a", instance_name: "instance-a" },
  { workspace_id: "workspace-b", owner_id: "owner-b", instance_name: "instance-b" },
];

function row(overrides = {}) {
  return {
    source_table: "mena_whatsapp_messages",
    source_row_id: "message-1",
    workspace_id: "workspace-a",
    owner_id: "owner-a",
    instance_name: "instance-a",
    group_jid: "120363000000000001@g.us",
    ...overrides,
  };
}

test("backfill groups exact matching IDs without inferring community relationships", () => {
  const plan = planWhatsAppGroupIdentityBackfill(
    [
      row(),
      row({
        source_table: "mena_whatsapp_group_selections",
        source_row_id: "selection-1",
      }),
      row({
        source_table: "mena_whatsapp_messages",
        source_row_id: "message-2",
        group_jid: "120363000000000002@g.us",
      }),
    ],
    connections,
  );

  assert.equal(plan.identities.length, 2);
  assert.equal(plan.assignments.length, 3);
  assert.equal(plan.identities[0].kind, "unknown");
  assert.equal(plan.issues.length, 0);
});

test("keeps missing connections and workspace ownership mismatches for review", () => {
  const plan = planWhatsAppGroupIdentityBackfill(
    [
      row({ source_row_id: "missing", instance_name: "gone" }),
      row({ source_row_id: "mismatch", owner_id: "owner-b" }),
      row({
        source_row_id: "other-workspace",
        workspace_id: "workspace-b",
        owner_id: "owner-b",
        instance_name: "instance-b",
      }),
    ],
    connections,
  );

  assert.equal(plan.assignments.length, 1);
  assert.deepEqual(
    plan.issues.map(({ reason }) => reason),
    ["CONNECTION_NOT_FOUND", "OWNER_CONNECTION_MISMATCH"],
  );
  assert.equal(plan.identities[0].workspaceId, "workspace-b");
});

test("keeps duplicate workspace connections ambiguous for manual review", () => {
  const plan = planWhatsAppGroupIdentityBackfill(
    [row()],
    [
      ...connections,
      {
        workspace_id: "workspace-a",
        owner_id: "owner-a",
        instance_name: "instance-a",
      },
    ],
  );

  assert.equal(plan.assignments.length, 0);
  assert.equal(plan.identities.length, 0);
  assert.equal(plan.issues[0].reason, "CONNECTION_AMBIGUOUS");
});

test("does not merge JIDs or workspaces with similar values", () => {
  const plan = planWhatsAppGroupIdentityBackfill(
    [
      row(),
      row({ source_row_id: "other-instance", instance_name: "instance-b", workspace_id: "workspace-b", owner_id: "owner-b" }),
      row({ source_row_id: "other-jid", group_jid: "120363000000000001@g.us " }),
    ],
    connections,
  );

  assert.equal(plan.identities.length, 3);
  assert.ok(plan.identities.some(({ groupJid }) => groupJid.endsWith("@g.us ")));
});

test("produces the same exact-match plan on retry", () => {
  const records = [row(), row({ source_row_id: "message-2" })];
  const firstPlan = planWhatsAppGroupIdentityBackfill(records, connections);
  const retryPlan = planWhatsAppGroupIdentityBackfill(records, connections);

  assert.deepEqual(retryPlan, firstPlan);
});
