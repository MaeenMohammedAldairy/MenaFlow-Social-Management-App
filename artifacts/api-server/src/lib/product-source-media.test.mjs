import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mock } from "node:test";

mock.module("@workspace/db", {
  namedExports: {
    db: {},
    menaWhatsAppMessageMedia: {},
    menaWhatsAppMessages: {},
    productExtractionSources: {},
  },
});
const { selectWhatsAppProductMediaIds } = await import("./product-source-media.ts");

const workspaceId = "workspace-a";
const t = Date.parse("2026-11-25T10:00:00.000Z");

function mediaRow(overrides = {}) {
  return {
    mediaId: "media-1",
    messageId: "message-1",
    mediaWorkspaceId: workspaceId,
    messageWorkspaceId: workspaceId,
    groupId: "group-a",
    groupJid: "120363012345678901@g.us",
    downloadStatus: "stored",
    messageTimestamp: new Date(t),
    messageCreatedAt: new Date(t + 5_000),
    mediaIndex: 0,
    mediaCreatedAt: new Date(t + 10_000),
    ...overrides,
  };
}

test("1 - a stored source media becomes a product media reference", () => {
  assert.deepEqual(
    selectWhatsAppProductMediaIds([mediaRow()], ["message-1"], workspaceId),
    ["media-1"],
  );
});

test("2 - four messages with three stored images produce three unique ordered refs", () => {
  const rows = [
    mediaRow({ mediaId: "m4", messageId: "msg4", messageTimestamp: new Date(t + 4000) }),
    mediaRow({ mediaId: "m2", messageId: "msg2", messageTimestamp: new Date(t + 1000) }),
    mediaRow({ mediaId: "m3", messageId: "msg3", messageTimestamp: new Date(t + 2000) }),
  ];
  assert.deepEqual(
    selectWhatsAppProductMediaIds(
      rows,
      ["msg2", "msg3", "msg4", "msg1"],
      workspaceId,
    ),
    ["m2", "m3", "m4"],
  );
});

test("3 - pending media is never offered as a ready product image", () => {
  assert.deepEqual(
    selectWhatsAppProductMediaIds([
      mediaRow({ downloadStatus: "pending" }),
    ], ["message-1"], workspaceId),
    [],
  );
});

test("4 - failed media is excluded without mutating the source row", () => {
  const row = mediaRow({ downloadStatus: "failed", mediaId: "failed-media" });
  const snapshot = JSON.stringify(row);
  assert.deepEqual(selectWhatsAppProductMediaIds([row], ["message-1"], workspaceId), []);
  assert.equal(JSON.stringify(row), snapshot);
});

test("5 - media from another workspace is rejected", () => {
  assert.deepEqual(selectWhatsAppProductMediaIds([
    mediaRow({ mediaWorkspaceId: "workspace-b" }),
    mediaRow({ mediaId: "valid", messageWorkspaceId: "workspace-b" }),
  ], ["message-1"], workspaceId), []);
});

test("6 - direct-message media cannot enter a group product", () => {
  assert.deepEqual(selectWhatsAppProductMediaIds([
    mediaRow({ groupId: null, groupJid: "120363012345678901@s.whatsapp.net" }),
    mediaRow({ mediaId: "wrong-jid", groupJid: "120363012345678901@s.whatsapp.net" }),
  ], ["message-1"], workspaceId), []);
});

test("7 - the same media id appearing twice is attached once", () => {
  assert.deepEqual(selectWhatsAppProductMediaIds([
    mediaRow(),
    mediaRow({ mediaCreatedAt: new Date(t + 20_000) }),
  ], ["message-1"], workspaceId), ["media-1"]);
});

test("8 - original message time wins over storage/insertion time", () => {
  const rows = [
    mediaRow({
      mediaId: "stored-first", messageId: "msg-a",
      messageTimestamp: new Date(t + 100),
      messageCreatedAt: new Date(t + 90_000),
      mediaCreatedAt: new Date(t + 95_000),
    }),
    mediaRow({
      mediaId: "stored-later", messageId: "msg-b",
      messageTimestamp: new Date(t + 200),
      messageCreatedAt: new Date(t),
      mediaCreatedAt: new Date(t),
    }),
  ];
  assert.deepEqual(selectWhatsAppProductMediaIds(rows, ["msg-b", "msg-a"], workspaceId),
    ["stored-first", "stored-later"]);
});

test("9 - worker and create-draft share one resolver implementation", () => {
  const worker = readFileSync("artifacts/api-server/src/lib/whatsapp-product-extraction.ts", "utf8");
  const draft = readFileSync("artifacts/api-server/src/routes/product-extractions.ts", "utf8");
  const relink = worker.match(/resolveWhatsAppSourceMediaIds\(/g) ?? [];
  assert.ok(relink.length >= 2, "worker create + late-media relink must use the resolver");
  assert.ok(draft.includes("resolveWhatsAppSourceMediaIds({"));
});

test("9b - create-draft replay returns the existing product and relink shares the resolver", () => {
  const draft = readFileSync("artifacts/api-server/src/routes/product-extractions.ts", "utf8");
  const worker = readFileSync("artifacts/api-server/src/lib/whatsapp-product-extraction.ts", "utf8");
  assert.ok(draft.includes('suggestion.status === "draft_created" && suggestion.productId'));
  assert.ok(worker.includes("relinkCompletedExtractionMedia"));
});

test("10 - manual product creation is unchanged (no WhatsApp source requirement)", () => {
  const source = readFileSync("artifacts/api-server/src/routes/product-management.ts", "utf8");
  assert.ok(source.includes('updatedReason: "manual_create"'));
  assert.ok(!source.includes("resolveWhatsAppSourceMediaIds"));
});

test("11 - a failed image does not hide the other stored images", () => {
  const rows = [
    mediaRow({ mediaId: "failed", downloadStatus: "failed", messageId: "msg-1" }),
    mediaRow({ mediaId: "stored-a", messageId: "msg-1" }),
    mediaRow({ mediaId: "stored-b", messageId: "msg-2" }),
  ];
  assert.deepEqual(
    selectWhatsAppProductMediaIds(rows, ["msg-1", "msg-2"], workspaceId),
    ["stored-a", "stored-b"],
  );
});

test("12 - catalog API resolves WhatsApp refs and the screen renders mediaPreviews", () => {
  const helpers = readFileSync("artifacts/api-server/src/routes/product-route-helpers.ts", "utf8");
  const screen = readFileSync(
    "artifacts/menaflow-mobile/components/products/ProductCatalogScreen.tsx",
    "utf8",
  );
  assert.ok(helpers.includes('eq(menaWhatsAppMessageMedia.downloadStatus, "stored")'));
  assert.ok(helpers.includes("eq(menaWhatsAppMessageMedia.workspaceId, workspaceId)"));
  assert.ok(screen.includes("editor.mediaPreviews.map"));
  assert.ok(screen.includes("product.mediaPreviews.slice(0, 4).map"));
  assert.ok(screen.includes("uri={product.mediaPreviews[0].url}"));
});

test("13 - removing a product image never removes the source media object", () => {
  const management = readFileSync("artifacts/api-server/src/routes/product-management.ts", "utf8");
  assert.ok(!management.includes("deleteMediaObject"));
  assert.ok(!management.includes("deleteProductMedia"));
  assert.ok(management.includes("...productInput,"));
});

test("14 - editor keeps API previews across autosave", () => {
  const workflow = readFileSync(
    "artifacts/menaflow-mobile/hooks/use-product-editor-workflow.ts",
    "utf8",
  );
  assert.ok(workflow.includes("mediaPreviews: parsed.mediaPreviews ?? current.mediaPreviews"));
});
