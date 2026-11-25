import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// app-workers.ts imports the whole server dependency graph, so a static check
// keeps this test runnable with the repo's dependency-free node test runner.
test("self-heal worker is registered with a five-minute monitor period", async () => {
  const source = await readFile(new URL("./app-workers.ts", import.meta.url), "utf8");
  assert.match(source, /"whatsapp-webhook-self-heal"/);
  assert.match(source, /intervalMs: 5 \* 60_000/);
  assert.match(source, /WHATSAPP_WEBHOOK_SELF_HEAL_ENABLED/);
  assert.match(source, /run: runWhatsAppWebhookSelfHeal/);
});
