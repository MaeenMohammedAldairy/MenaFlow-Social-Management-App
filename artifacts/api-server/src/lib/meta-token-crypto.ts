import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export function metaTokenEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("MISSING_ENCRYPTION_KEY");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptMetaToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", metaTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export interface DecryptedMetaToken {
  accessToken: string;
  rotatedCiphertext?: string;
}

export function decryptMetaToken(payload: string): string {
  return decryptMetaTokenForRotation(payload).accessToken;
}

export function decryptMetaTokenForRotation(payload: string): DecryptedMetaToken {
  const currentKey = process.env.ENCRYPTION_KEY;
  if (!currentKey) throw new Error("MISSING_ENCRYPTION_KEY");

  try {
    return { accessToken: decryptWithKey(payload, currentKey) };
  } catch (currentKeyError) {
    const previousKey = process.env.ENCRYPTION_KEY_PREVIOUS;
    if (!previousKey || previousKey === currentKey) {
      throw new Error("INVALID_ENCRYPTED_TOKEN");
    }

    try {
      const accessToken = decryptWithKey(payload, previousKey);
      return {
        accessToken,
        rotatedCiphertext: encryptMetaToken(accessToken),
      };
    } catch {
      throw new Error("INVALID_ENCRYPTED_TOKEN");
    }
  }
}

function decryptWithKey(payload: string, secret: string): string {
  const [ivValue, tagValue, encryptedValue] = payload.split(":");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("INVALID_ENCRYPTED_TOKEN");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret, "utf8").digest(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
