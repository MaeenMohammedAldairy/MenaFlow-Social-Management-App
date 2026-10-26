import assert from "node:assert/strict";
import test from "node:test";
import {
  pairingCodeFrom,
  pairingQrBase64From,
} from "./whatsapp-pairing.ts";

test("reads a top-level Evolution pairingCode", () => {
  assert.equal(pairingCodeFrom({ pairingCode: "  1234-5678  " }), "1234-5678");
});

test("reads pairing codes in common Evolution response envelopes", () => {
  assert.equal(
    pairingCodeFrom({ data: { pairingCode: "1234-5678" } }),
    "1234-5678",
  );
  assert.equal(
    pairingCodeFrom({ qrcode: { pairingCode: "1234-5678" } }),
    "1234-5678",
  );
  assert.equal(
    pairingCodeFrom({ instance: { qrcode: { pairingCode: "1234-5678" } } }),
    "1234-5678",
  );
  assert.equal(
    pairingCodeFrom({
      data: { instance: { qrCode: { pairingCode: "1234-5678" } } },
    }),
    "1234-5678",
  );
});

test("does not treat a QR code payload as a WhatsApp pairing code", () => {
  assert.equal(pairingCodeFrom({ code: "qr-payload", base64: "qr-image" }), null);
  assert.equal(pairingCodeFrom({ data: { code: "qr-payload" } }), null);
});

test("ignores empty and non-string pairing codes", () => {
  assert.equal(pairingCodeFrom({ pairingCode: "  " }), null);
  assert.equal(pairingCodeFrom(null), null);
});

test("reads Evolution QR image data separately from its pairing code", () => {
  assert.equal(
    pairingQrBase64From({
      qrcode: { pairingCode: "12345678", base64: "data:image/png;base64,abc" },
    }),
    "data:image/png;base64,abc",
  );
  assert.equal(
    pairingQrBase64From({ data: { qrcode: { base64: "qr-image" } } }),
    "qr-image",
  );
  assert.equal(pairingQrBase64From({ code: "qr-payload" }), null);
});
