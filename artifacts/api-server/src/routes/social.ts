import { getAuth } from "@clerk/express";
import { and, eq, gt, lte } from "drizzle-orm";
import {
  db,
  menaMetaConnections,
  menaOAuthStates,
} from "@workspace/db";
import {
  GetSocialConnectionsResponse,
  PostMetaConnectResponse,
} from "@workspace/api-zod";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { requireOwner } from "../lib/owner-access";

const router: IRouter = Router();
const GRAPH_VERSION = "v26.0";
const OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
].join(",");
const STATE_TTL_MS = 10 * 60 * 1000;
const APP_REDIRECT = "menaflow-mobile://oauth/meta";

function getMetaRedirectUri(): string {
  const configured = process.env.MENA_FACEBOOK_REDIRECT_URI?.trim();
  const developmentDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
  const redirectUri =
    configured ||
    (developmentDomain
      ? `https://${developmentDomain}/api/social/meta/callback`
      : "");

  if (!redirectUri) throw new Error("META_REDIRECT_URI_NOT_CONFIGURED");

  const parsed = new URL(redirectUri);
  if (
    (parsed.protocol !== "https:" && parsed.hostname !== "localhost") ||
    parsed.pathname !== "/api/social/meta/callback" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("META_REDIRECT_URI_INVALID");
  }
  return parsed.toString();
}

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error("ENCRYPTION_KEY_NOT_CONFIGURED");
  return createHash("sha256").update(secret, "utf8").digest();
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptToken(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("ENCRYPTED_TOKEN_INVALID");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function makeStateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function queryString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function appRedirect(res: Response, status: string, reason?: string): void {
  const params = new URLSearchParams({ status });
  if (reason) params.set("reason", reason);
  res
    .setHeader("Cache-Control", "no-store")
    .setHeader("Referrer-Policy", "no-referrer")
    .redirect(302, `${APP_REDIRECT}?${params.toString()}`);
}

async function graphJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("META_GRAPH_REQUEST_FAILED");
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (payload.error) throw new Error("META_GRAPH_REQUEST_FAILED");
  return payload;
}

router.get("/social/connections", requireOwner, async (req, res) => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.ownerId, ownerId))
    .limit(1);

  res.json(
    GetSocialConnectionsResponse.parse({
      facebook: connection
        ? {
            accountId: connection.pageId,
            accountName: connection.pageName,
            connectedAt: connection.connectedAt.toISOString(),
          }
        : null,
      instagram:
        connection?.instagramUserId && connection.instagramUsername
          ? {
              accountId: connection.instagramUserId,
              accountName: connection.instagramUsername,
              connectedAt: connection.connectedAt.toISOString(),
            }
          : null,
    }),
  );
});

router.post("/social/meta/connect", requireOwner, async (req, res) => {
  const ownerId = getAuth(req).userId;
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  if (!appId || !process.env.FACEBOOK_APP_SECRET || !process.env.ENCRYPTION_KEY) {
    res.status(503).json({ error: "إعداد ربط Meta غير مكتمل." });
    return;
  }

  try {
    const redirectUri = getMetaRedirectUri();
    const state = randomBytes(32).toString("base64url");
    const now = new Date();
    await db.delete(menaOAuthStates).where(lte(menaOAuthStates.expiresAt, now));
    await db.insert(menaOAuthStates).values({
      stateHash: makeStateHash(state),
      ownerId,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    });

    const authorizationUrl = new URL(
      `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    );
    authorizationUrl.search = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: OAUTH_SCOPES,
      state,
    }).toString();

    res.json(
      PostMetaConnectResponse.parse({
        authorizationUrl: authorizationUrl.toString(),
        callbackUri: redirectUri,
      }),
    );
  } catch {
    res.status(503).json({ error: "تعذر تجهيز ربط Meta. تحقق من إعداد عنوان العودة." });
  }
});

router.get("/social/meta/callback", async (req, res) => {
  const state = queryString(req.query.state);
  const code = queryString(req.query.code);
  if (!state) {
    appRedirect(res, "error", "invalid_state");
    return;
  }

  try {
    const now = new Date();
    const [stateRow] = await db
      .delete(menaOAuthStates)
      .where(
        and(
          eq(menaOAuthStates.stateHash, makeStateHash(state)),
          gt(menaOAuthStates.expiresAt, now),
        ),
      )
      .returning({ ownerId: menaOAuthStates.ownerId });

    if (!stateRow) {
      appRedirect(res, "error", "expired_state");
      return;
    }
    if (queryString(req.query.error) || !code) {
      appRedirect(res, "error", "authorization_denied");
      return;
    }

    const appId = process.env.FACEBOOK_APP_ID?.trim();
    const appSecret = process.env.FACEBOOK_APP_SECRET;
    if (!appId || !appSecret || !process.env.ENCRYPTION_KEY) {
      appRedirect(res, "error", "server_configuration");
      return;
    }

    const redirectUri = getMetaRedirectUri();
    const codeParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    });
    const shortToken = await graphJson<{
      access_token: string;
      expires_in?: number;
    }>(
      new URL(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${codeParams}`,
      ),
    );

    const longTokenParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken.access_token,
    });
    const longToken = await graphJson<{ access_token: string }>(
      new URL(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${longTokenParams}`,
      ),
    );

    const accountsUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`,
    );
    accountsUrl.search = new URLSearchParams({
      fields:
        "id,name,access_token,instagram_business_account{id,username}",
      limit: "100",
      access_token: longToken.access_token,
    }).toString();
    const accounts = await graphJson<{
      data?: Array<{
        id: string;
        name: string;
        access_token?: string;
        instagram_business_account?: { id: string; username?: string };
      }>;
    }>(accountsUrl);

    const page = accounts.data?.find(
      (candidate) =>
        candidate.access_token && candidate.instagram_business_account,
    ) ?? accounts.data?.find((candidate) => candidate.access_token);

    if (!page?.access_token) {
      appRedirect(res, "error", "no_manageable_page");
      return;
    }

    await db
      .insert(menaMetaConnections)
      .values({
        ownerId: stateRow.ownerId,
        pageId: page.id,
        pageName: page.name,
        encryptedPageAccessToken: encryptToken(page.access_token),
        instagramUserId: page.instagram_business_account?.id ?? null,
        instagramUsername:
          page.instagram_business_account?.username ?? null,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: menaMetaConnections.ownerId,
        set: {
          pageId: page.id,
          pageName: page.name,
          encryptedPageAccessToken: encryptToken(page.access_token),
          instagramUserId: page.instagram_business_account?.id ?? null,
          instagramUsername:
            page.instagram_business_account?.username ?? null,
          connectedAt: new Date(),
        },
      });

    appRedirect(
      res,
      page.instagram_business_account ? "connected" : "facebook_connected",
    );
  } catch {
    appRedirect(res, "error", "connection_failed");
  }
});

router.delete("/social/meta", requireOwner, async (req, res) => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  await db
    .delete(menaMetaConnections)
    .where(eq(menaMetaConnections.ownerId, ownerId));
  res.json({ disconnected: true });
});

export default router;
