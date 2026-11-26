import assert from "node:assert/strict";
import test from "node:test";

import { whatsappDirectConversationLabel } from "./whatsapp-direct-conversation-label.ts";

test("shows the saved contact name when Evolution supplied one", () => {
  assert.equal(
    whatsappDirectConversationLabel({
      senderName: "  ميناءフロー  ",
      customerNumber: "967777123456",
    }),
    "ميناءフロー",
  );
});

test("falls back to the phone number when no name is saved", () => {
  for (const senderName of [null, undefined, "", "   ", "bad\nname", "x".repeat(121)]) {
    assert.equal(
      whatsappDirectConversationLabel({
        senderName,
        customerNumber: "967777123456",
      }),
      "967777123456",
    );
  }
});

test("also falls back for opaque LID conversation labels", () => {
  assert.equal(
    whatsappDirectConversationLabel({
      senderName: null,
      customerNumber: "معرّف 12345678901234",
    }),
    "معرّف 12345678901234",
  );
});
