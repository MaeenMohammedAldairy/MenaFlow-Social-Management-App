import { asc, inArray, lt } from "drizzle-orm";
import {
  db,
  menaWhatsAppDirectMessages,
  menaWhatsAppOrderIntakes,
} from "@workspace/db";

const retentionDeleteBatchSize = 1000;
const maximumRetentionBatches = 10;

export async function purgeExpiredWhatsAppDirectMessages(
  now = new Date(),
): Promise<number> {
  let deletedCount = 0;
  for (let batch = 0; batch < maximumRetentionBatches; batch += 1) {
    const expired = await db
      .select({ id: menaWhatsAppDirectMessages.id })
      .from(menaWhatsAppDirectMessages)
      .where(lt(menaWhatsAppDirectMessages.expiresAt, now))
      .orderBy(asc(menaWhatsAppDirectMessages.expiresAt))
      .limit(retentionDeleteBatchSize);
    if (expired.length === 0) break;
    await db
      .delete(menaWhatsAppDirectMessages)
      .where(inArray(menaWhatsAppDirectMessages.id, expired.map(({ id }) => id)));
    deletedCount += expired.length;
  }
  for (let batch = 0; batch < maximumRetentionBatches; batch += 1) {
    const expiredIntakes = await db
      .select({ id: menaWhatsAppOrderIntakes.id })
      .from(menaWhatsAppOrderIntakes)
      .where(lt(menaWhatsAppOrderIntakes.expiresAt, now))
      .orderBy(asc(menaWhatsAppOrderIntakes.expiresAt))
      .limit(retentionDeleteBatchSize);
    if (expiredIntakes.length === 0) break;
    await db
      .delete(menaWhatsAppOrderIntakes)
      .where(
        inArray(
          menaWhatsAppOrderIntakes.id,
          expiredIntakes.map(({ id }) => id),
        ),
      );
    deletedCount += expiredIntakes.length;
  }
  return deletedCount;
}