import { and, eq } from "drizzle-orm";
import { db, menaMetaConnections } from "@workspace/db";
import { decryptMetaTokenForRotation } from "./meta-token-crypto.ts";

export async function metaConnectionAccessToken(
  connection: typeof menaMetaConnections.$inferSelect,
): Promise<string> {
  const decrypted = decryptMetaTokenForRotation(
    connection.encryptedPageAccessToken,
  );
  if (decrypted.rotatedCiphertext) {
    await db
      .update(menaMetaConnections)
      .set({ encryptedPageAccessToken: decrypted.rotatedCiphertext })
      .where(
        and(
          eq(menaMetaConnections.workspaceId, connection.workspaceId),
          eq(
            menaMetaConnections.encryptedPageAccessToken,
            connection.encryptedPageAccessToken,
          ),
        ),
      );
  }
  return decrypted.accessToken;
}
