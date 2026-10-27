import { randomUUID, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaAutoReplySettings,
  menaMetaConnections,
  menaMetaInboxItems,
} from "@workspace/db";
import { metaAutoReplyEnabled } from "../lib/meta-auto-reply";
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookSignature,
} from "../lib/meta-webhook";
import { metaString } from "../lib/meta-inbox-utils";

const router = Router();

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

router.get("/social/meta/webhook", (req, res) => {
  const verifyToken = process.env.MENA_META_WEBHOOK_VERIFY_TOKEN?.trim();
  const mode = metaString(req.query["hub.mode"]);
  const token = metaString(req.query["hub.verify_token"]);
  const challenge = metaString(req.query["hub.challenge"]);
  if (!verifyToken) {
    res.status(503).send("Webhook verification token is not configured.");
    return;
  }
  if (
    mode !== "subscribe" ||
    !token ||
    !challenge ||
    !constantTimeEqual(token, verifyToken)
  ) {
    res.status(403).send("Webhook verification failed.");
    return;
  }
  res.status(200).type("text/plain").send(challenge);
});

router.post("/social/meta/webhook", async (req, res) => {
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  if (
    !rawBody ||
    !verifyMetaWebhookSignature(
      rawBody,
      req.get("x-hub-signature-256"),
      appSecret,
    )
  ) {
    res.status(401).json({ error: "توقيع Meta webhook غير صالح." });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "صيغة حدث Meta غير صالحة." });
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.status(400).json({ error: "صيغة حدث Meta غير صالحة." });
    return;
  }
  const objectType = metaString((payload as Record<string, unknown>).object);
  const platform =
    objectType === "page"
      ? "facebook"
      : objectType === "instagram"
        ? "instagram"
        : null;
  if (!platform) {
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  const entries = Array.isArray((payload as Record<string, unknown>).entry)
    ? ((payload as Record<string, unknown>).entry as unknown[])
    : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const accountId = metaString((entry as Record<string, unknown>).id);
    if (!accountId) continue;
    const predicate =
      platform === "facebook"
        ? eq(menaMetaConnections.pageId, accountId)
        : eq(menaMetaConnections.instagramUserId, accountId);
    const [connection] = await db
      .select({
        ownerId: menaMetaConnections.ownerId,
        workspaceId: menaMetaConnections.workspaceId,
      })
      .from(menaMetaConnections)
      .where(predicate)
      .limit(1);
    if (!connection) continue;

    const events = parseMetaWebhookEvents({ entry: [entry] }, platform);
    for (let offset = 0; offset < events.length; offset += 100) {
      await db.transaction(async (transaction) => {
        const inserted = await transaction
          .insert(menaMetaInboxItems)
          .values(
            events.slice(offset, offset + 100).map((event) => {
              const { media, ...item } = event;
              return {
                id: randomUUID(),
                ownerId: connection.ownerId,
                workspaceId: connection.workspaceId,
                ...item,
                metadata: { media },
              };
            }),
          )
          .onConflictDoNothing()
          .returning({
            id: menaMetaInboxItems.id,
            platform: menaMetaInboxItems.platform,
            kind: menaMetaInboxItems.kind,
          });
        if (inserted.length === 0) return;

        const [settings] = await transaction
          .select()
          .from(menaMetaAutoReplySettings)
          .where(
            eq(menaMetaAutoReplySettings.workspaceId, connection.workspaceId),
          )
          .limit(1);
        if (!settings?.enabled) return;

        const eligible = inserted.filter((item) =>
          metaAutoReplyEnabled(settings, item.platform, item.kind),
        );
        if (eligible.length === 0) return;
        await transaction
          .insert(menaMetaAutoReplyJobs)
          .values(
            eligible.map((item) => ({
              id: randomUUID(),
              ownerId: connection.ownerId,
              workspaceId: connection.workspaceId,
              inboxItemId: item.id,
            })),
          )
          .onConflictDoNothing();
      });
    }
  }

  res.status(200).json({ received: true });
});

export default router;
