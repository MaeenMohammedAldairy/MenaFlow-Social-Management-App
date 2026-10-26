import assert from "node:assert/strict";
import test from "node:test";
import { isWhatsAppOptOutMessage } from "./whatsapp-opt-out.ts";

test("detects exact English and Arabic opt-out messages", () => {
  assert.equal(isWhatsAppOptOutMessage(" STOP! "), true);
  assert.equal(isWhatsAppOptOutMessage("إلغاء الاشتراك"), true);
  assert.equal(isWhatsAppOptOutMessage("أريد معرفة الإلغاء"), false);
});
