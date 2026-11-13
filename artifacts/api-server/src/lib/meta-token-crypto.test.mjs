import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptMetaToken,
  decryptMetaTokenForRotation,
  decryptSensitiveValue,
  decryptSensitiveValueForRotation,
  encryptMetaToken,
  encryptSensitiveValue,
} from "./meta-token-crypto.ts";

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

test("encrypts and decrypts tokens in the existing IV/tag/ciphertext format", () => {
  try {
    process.env.ENCRYPTION_KEY = "test-encryption-key";
    const encrypted = encryptMetaToken("meta-access-token");
    assert.match(encrypted, /^[\w-]+:[\w-]+:[\w-]+$/);
    assert.equal(decryptMetaToken(encrypted), "meta-access-token");
  } finally {
    if (originalEncryptionKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    }
  }
});

test("encrypts arbitrary private values with the shared authenticated format", () => {
  const configuredKey = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = "test-encryption-key";
    const encrypted = encryptSensitiveValue("private WhatsApp text");
    assert.match(encrypted, /^[\w-]+:[\w-]+:[\w-]+$/);
    assert.notEqual(encrypted, "private WhatsApp text");
    assert.equal(decryptSensitiveValue(encrypted), "private WhatsApp text");
    assert.equal(
      decryptSensitiveValueForRotation(encrypted).value,
      "private WhatsApp text",
    );
  } finally {
    if (configuredKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = configuredKey;
  }
});

test("requires an encryption key instead of silently using a default", () => {
  const configuredKey = process.env.ENCRYPTION_KEY;
  try {
    delete process.env.ENCRYPTION_KEY;
    assert.throws(
      () => encryptMetaToken("meta-access-token"),
      { message: "MISSING_ENCRYPTION_KEY" },
    );
  } finally {
    if (configuredKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = configuredKey;
    }
  }
});

test("requires a configured encryption key when decrypting", () => {
  const configuredKey = process.env.ENCRYPTION_KEY;
  try {
    delete process.env.ENCRYPTION_KEY;
    assert.throws(
      () => decryptMetaToken("valid-looking-iv:valid-looking-tag:ciphertext"),
      { message: "MISSING_ENCRYPTION_KEY" },
    );
  } finally {
    if (configuredKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = configuredKey;
    }
  }
});

test("decrypts with an explicitly configured previous key and returns a rotated ciphertext", () => {
  const configuredKey = process.env.ENCRYPTION_KEY;
  const configuredPreviousKey = process.env.ENCRYPTION_KEY_PREVIOUS;
  try {
    process.env.ENCRYPTION_KEY = "previous-test-encryption-key";
    process.env.ENCRYPTION_KEY_PREVIOUS = "previous-test-encryption-key";
    const oldCiphertext = encryptMetaToken("legacy-test-token");
    process.env.ENCRYPTION_KEY = "replacement-current-test-key";

    const result = decryptMetaTokenForRotation(oldCiphertext);
    assert.equal(result.accessToken, "legacy-test-token");
    assert.ok(result.rotatedCiphertext);
    assert.notEqual(result.rotatedCiphertext, oldCiphertext);
    assert.equal(decryptMetaToken(result.rotatedCiphertext), "legacy-test-token");
  } finally {
    if (configuredKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = configuredKey;
    if (configuredPreviousKey === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = configuredPreviousKey;
  }
});

test("does not fall back to an embedded legacy key", () => {
  const configuredKey = process.env.ENCRYPTION_KEY;
  const configuredPreviousKey = process.env.ENCRYPTION_KEY_PREVIOUS;
  try {
    process.env.ENCRYPTION_KEY = "current-test-encryption-key";
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    assert.throws(
      () => decryptMetaToken("legacy-ciphertext-that-current-key-cannot-decrypt"),
      { message: "INVALID_ENCRYPTED_TOKEN" },
    );
  } finally {
    if (configuredKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = configuredKey;
    if (configuredPreviousKey === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = configuredPreviousKey;
  }
});

test("rejects malformed and tampered encrypted tokens", () => {
  const configuredKey = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = "test-encryption-key";
    assert.throws(
      () => decryptMetaToken("not-an-encrypted-token"),
      { message: "INVALID_ENCRYPTED_TOKEN" },
    );

    const [iv, tag, ciphertext] = encryptMetaToken("meta-access-token").split(":");
    const tamperedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    const tampered = `${iv}:${tamperedTag}:${ciphertext}`;
    assert.throws(() => decryptMetaToken(tampered));
  } finally {
    if (configuredKey === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = configuredKey;
    }
  }
});
