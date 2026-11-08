import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { and, eq, gt, lte, ne } from "drizzle-orm";
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import {
  menaMetaConnections,
  menaOAuthStates,
  workspaceMembers,
  db,
} from "@workspace/db";
import {
  PostMetaConnectBody,
  PostMetaConnectResponse,
} from "@workspace/api-zod";
import { requestOwnerId } from "../lib/owner-access";
import {
  requireWorkspace,
  requestWorkspaceContext,
  requestWorkspaceId,
} from "../lib/workspace-context";
import {
  canManageMetaConnections,
  grantedMetaPermissions,
  metaGraphErrorDetails,
  hasGrantedMetaPageListPermission,
  metaConnectionConflictDetail,
  metaConnectionConflictFromError,
  metaOAuthScopes,
  missingMetaIntegrationPermissions,
  normalizeMetaAccountId,
  type MetaIntegration,
} from "../lib/meta-oauth";
import { queryString } from "../lib/value-utils.ts";
import {
  buildFacebookPageByIdUrl,
  buildMetaPageListUrl,
  findFacebookPageWithUserTokens,
  grantedFacebookPageIds,
  inspectFacebookPage,
  inspectMetaPageList,
  metaPageListFailureDetail,
} from "../lib/meta-pages";
import { resolveMetaWebReturnOrigin } from "../lib/meta-web-origin";
import { getMetaGraphVersion } from "../lib/meta-graph-config";
import { encryptMetaToken } from "../lib/meta-token-crypto";
import { activateMetaWebhookSubscriptionsForConnection } from "../lib/meta-webhook-subscriptions";
import { logger } from "../lib/logger";
import {
  canConnectChannel,
  canConnectMetaAccounts,
} from "../lib/subscriptions";

const router = Router();
const GRAPH_VERSION = getMetaGraphVersion();
const STATE_TTL_MS = 10 * 60 * 1000;
const APP_REDIRECT = "menaflow-mobile://oauth/meta";

const requireMetaConnectionManager: RequestHandler = (req, res, next) => {
  const context = requestWorkspaceContext(req);
  if (!context) {
    next(new Error("WORKSPACE_CONTEXT_MISSING"));
    return;
  }
  if (!canManageMetaConnections(context.role)) {
    res.status(403).json({
      error: "يقتصر تعديل اتصالات Meta على مالك مساحة العمل.",
      code: "WORKSPACE_MANAGEMENT_REQUIRED",
    });
    return;
  }
  next();
};

function getMetaRedirectUri(): string | null {
  const configured = process.env.MENA_FACEBOOK_REDIRECT_URI?.trim();
  const developmentDomain = process.env.EXPO_PUBLIC_DOMAIN?.trim();
  const normalizedDevelopmentDomain = developmentDomain
    ? /^https?:\/\//i.test(developmentDomain)
      ? developmentDomain
      : `https://${developmentDomain}`
    : undefined;
  const redirectUri =
    configured ||
    (process.env.NODE_ENV !== "production" && normalizedDevelopmentDomain
      ? `${normalizedDevelopmentDomain.replace(/\/+$/, "")}/api/social/meta/callback`
      : process.env.NODE_ENV === "production"
        ? undefined
        : "http://localhost:5000/api/social/meta/callback");
  if (!redirectUri) return null;

  try {
    const parsed = new URL(redirectUri);
    if (
      process.env.NODE_ENV === "production" &&
      (parsed.protocol !== "https:" ||
        ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function metaWebReturnOrigin(req: Request): string | undefined {
  return resolveMetaWebReturnOrigin(
    req.get("origin"),
    process.env.NODE_ENV === "production"
      ? []
      : [
          process.env.EXPO_PUBLIC_DOMAIN,
        ].filter((domain): domain is string => Boolean(domain)),
    process.env.MENA_FACEBOOK_WEB_ORIGINS,
  );
}

function metaOAuthState(returnOrigin?: string): string {
  const nonce = randomBytes(32).toString("base64url");
  return returnOrigin
    ? `${nonce}.${Buffer.from(returnOrigin).toString("base64url")}`
    : nonce;
}

function metaOAuthReturnOrigin(state: string): string | undefined {
  const separator = state.indexOf(".");
  if (separator < 0) return undefined;

  try {
    const origin = Buffer.from(
      state.slice(separator + 1),
      "base64url",
    ).toString("utf8");
    const parsed = new URL(origin);
    return parsed.origin === origin ? origin : undefined;
  } catch {
    return undefined;
  }
}

function makeStateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function appRedirect(
  res: Response,
  status: string,
  reason?: string,
  returnOrigin?: string,
  detail?: string,
): void {
  const params = new URLSearchParams({ status });
  if (reason) params.set("reason", reason);
  if (detail) params.set("detail", detail);
  res
    .setHeader("Cache-Control", "no-store")
    .setHeader("Referrer-Policy", "no-referrer")
    .redirect(
      302,
      returnOrigin
        ? `${returnOrigin}/oauth/meta?${params.toString()}`
        : `${APP_REDIRECT}?${params.toString()}`,
    );
}

class MetaGraphRequestError extends Error {
  constructor(
    readonly stage: string,
    readonly status: number | undefined,
    readonly details: ReturnType<typeof metaGraphErrorDetails>,
    readonly networkFailure = false,
    readonly hasData = false,
    readonly pageCount = 0,
  ) {
    super("META_GRAPH_REQUEST_FAILED");
  }
}

class MetaConnectionOwnershipConflict extends Error {
  constructor(readonly account: "facebook_page" | "instagram_account") {
    super("META_ACCOUNT_ALREADY_CONNECTED");
  }
}

async function assertMetaExternalAccountAvailable(
  workspaceId: string,
  pageId: string,
  instagramUserId: string | null,
): Promise<void> {
  const [pageConflict] = await db
    .select({ workspaceId: menaMetaConnections.workspaceId })
    .from(menaMetaConnections)
    .where(
      and(
        eq(menaMetaConnections.pageId, pageId),
        ne(menaMetaConnections.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (pageConflict) {
    throw new MetaConnectionOwnershipConflict("facebook_page");
  }

  if (!instagramUserId || instagramUserId === "") return;
  const [instagramConflict] = await db
    .select({ workspaceId: menaMetaConnections.workspaceId })
    .from(menaMetaConnections)
    .where(
      and(
        eq(menaMetaConnections.instagramUserId, instagramUserId),
        ne(menaMetaConnections.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (instagramConflict) {
    throw new MetaConnectionOwnershipConflict("instagram_account");
  }
}

async function graphJsonResponse(
  url: URL,
  stage: string,
  options?: { method?: string; body?: URLSearchParams | string },
): Promise<{ status: number; payload: unknown }> {
  let status: number;
  let responseBody: string;
  try {
    const result = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const request = httpsRequest(
          url,
          {
            method: options?.method ?? "GET",
            family: 4,
            headers: {
              Accept: "application/json",
              ...(options?.body
                ? { "Content-Type": "application/x-www-form-urlencoded" }
                : {}),
            },
            signal: AbortSignal.timeout(15_000),
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer | string) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on("error", reject);
            response.on("end", () => {
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );
        request.on("error", reject);
        if (options?.body) {
          request.write(
            options.body instanceof URLSearchParams
              ? options.body.toString()
              : options.body,
          );
        }
        request.end();
      },
    );
    status = result.status;
    responseBody = result.body;
  } catch (error) {
    const failure = error instanceof Error ? error : undefined;
    const cause =
      failure?.cause && typeof failure.cause === "object"
        ? failure.cause
        : undefined;
    const errorCode =
      failure && "code" in failure && typeof failure.code === "string"
        ? failure.code
        : undefined;
    const causeCode =
      cause && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : undefined;
    console.warn("Meta Graph network request failed:", {
      stage,
      errorName: failure?.name ?? typeof error,
      errorCode,
      causeCode,
    });
    throw new MetaGraphRequestError(stage, undefined, undefined, true);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new MetaGraphRequestError(stage, status, undefined, false, false, 0);
  }

  const details = metaGraphErrorDetails(payload);
  const pageDiagnostics =
    stage === "list_pages"
      ? inspectMetaPageList(payload).diagnostics
      : { hasData: false, pageCount: 0 };
  if (status < 200 || status >= 300 || details) {
    throw new MetaGraphRequestError(
      stage,
      status,
      details,
      false,
      pageDiagnostics.hasData,
      pageDiagnostics.pageCount,
    );
  }
  if (stage === "list_pages") {
    console.info("Meta OAuth page-list response:", {
      httpStatus: status,
      ...pageDiagnostics,
    });
  }
  return { status, payload };
}

async function graphJson<T>(
  url: URL,
  stage: string,
  options?: { method?: string; body?: URLSearchParams | string },
): Promise<T> {
  const { payload } = await graphJsonResponse(url, stage, options);
  return payload as T;
}

router.post("/social/meta/connect", requireWorkspace, requireMetaConnectionManager, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  const parsedBody = PostMetaConnectBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: "حدد تكامل Facebook أو Instagram." });
    return;
  }
  const requestedIntegration: MetaIntegration = parsedBody.data.integration;
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  if (!appId || !appSecret) {
    res.status(503).json({
      error:
        "إعداد تطبيق Meta غير مكتمل. اضبط FACEBOOK_APP_ID وFACEBOOK_APP_SECRET.",
    });
    return;
  }

  try {
    const channelAccess = await canConnectChannel(
      workspaceId,
      requestedIntegration,
    );
    if (!channelAccess.allowed) {
      res.status(403).json({
        error: "بلغت الحد الأقصى لقنوات خطتك الحالية. تظهر خيارات الترقية قريبًا.",
        code: "SUBSCRIPTION_LIMIT_REACHED",
        usage: channelAccess.used,
        limit: channelAccess.limit,
      });
      return;
    }

    const redirectUri = getMetaRedirectUri();
    if (!redirectUri) {
      res.status(503).json({
        error: "إعداد عنوان العودة العام والآمن لـ Meta غير مكتمل.",
      });
      return;
    }
    const returnOrigin = metaWebReturnOrigin(req);
    const state = metaOAuthState(returnOrigin);
    const now = new Date();
    await db.delete(menaOAuthStates).where(lte(menaOAuthStates.expiresAt, now));
    await db.insert(menaOAuthStates).values({
      stateHash: makeStateHash(state),
      ownerId,
      workspaceId,
      requestedIntegration,
      expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    });

    const authorizationUrl = new URL(
      `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
    );
    authorizationUrl.search = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: metaOAuthScopes(requestedIntegration).join(","),
      auth_type: "rerequest",
      return_scopes: "true",
      state,
    }).toString();

    res.json(
      PostMetaConnectResponse.parse({
        authorizationUrl: authorizationUrl.toString(),
        callbackUri: redirectUri,
      }),
    );
  } catch (err) {
    console.error("Error setting up Meta connect:", err);
    res
      .status(503)
      .json({ error: "تعذر تجهيز ربط Meta. تحقق من إعداد عنوان العودة." });
  }
});

router.get("/social/meta/callback", async (req, res) => {
  const state = queryString(req.query.state);
  const code = queryString(req.query.code);
  let returnOrigin: string | undefined;
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
      .returning({
        ownerId: menaOAuthStates.ownerId,
        workspaceId: menaOAuthStates.workspaceId,
        requestedIntegration: menaOAuthStates.requestedIntegration,
      });

    if (!stateRow) {
      appRedirect(res, "error", "expired_state");
      return;
    }
    returnOrigin = metaOAuthReturnOrigin(state);
    const [membership] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, stateRow.workspaceId),
          eq(workspaceMembers.userId, stateRow.ownerId),
        ),
      )
      .limit(1);
    if (!membership || !canManageMetaConnections(membership.role)) {
      appRedirect(
        res,
        "error",
        "workspace_management_required",
        returnOrigin,
        "لم يعد حسابك مخولاً لإدارة اتصالات مساحة العمل.",
      );
      return;
    }
    if (queryString(req.query.error) || !code) {
      appRedirect(
        res,
        "error",
        "authorization_denied",
        returnOrigin,
        "تحقق من تفعيل الصلاحيات المطلوبة لهذا التكامل في تطبيق Meta ثم أعد المحاولة.",
      );
      return;
    }

    const appId = process.env.FACEBOOK_APP_ID?.trim();
    const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      appRedirect(res, "error", "meta_credentials_missing", returnOrigin);
      return;
    }

    const redirectUri = getMetaRedirectUri();
    if (!redirectUri) {
      appRedirect(res, "error", "redirect_uri_not_configured", returnOrigin);
      return;
    }
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
      new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`),
      "exchange_short_token",
      { method: "POST", body: codeParams },
    );

    const longTokenParams = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken.access_token,
    });
    const longToken = await graphJson<{ access_token: string }>(
      new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`),
      "exchange_long_token",
      { method: "POST", body: longTokenParams },
    );
    const userAccessToken = longToken.access_token;
    const permissionsUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions`,
    );
    permissionsUrl.searchParams.set("access_token", userAccessToken);
    const permissions = await graphJson<{
      data?: Array<{ permission?: string; status?: string }>;
    }>(permissionsUrl, "list_permissions");
    const grantedPermissions = grantedMetaPermissions(permissions.data);
    const pageLookup = await findFacebookPageWithUserTokens(
      [
        { kind: "long_lived", value: userAccessToken },
        { kind: "short_lived", value: shortToken.access_token },
      ],
      async (token) => {
        const { status, payload } = await graphJsonResponse(
          buildMetaPageListUrl(GRAPH_VERSION, token),
          "list_pages",
        );
        return { httpStatus: status, payload };
      },
    );
    let page = pageLookup.page;
    console.info("Meta OAuth Facebook page lookup:", {
      attempts: pageLookup.attempts,
      pageFound: Boolean(page),
    });

    let selectedPageError: MetaGraphRequestError | undefined;
    let debugTokenIsValid: boolean | undefined;
    let debugTokenMatchesApp: boolean | undefined;
    let grantedPageCount: number | undefined;
    if (!page && !pageLookup.error) {
      try {
        const debugTokenUrl = new URL(
          `https://graph.facebook.com/${GRAPH_VERSION}/debug_token`,
        );
        debugTokenUrl.searchParams.set("input_token", userAccessToken);
        debugTokenUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
        const debugToken = await graphJson<{
          data?: {
            app_id?: string;
            is_valid?: boolean;
          };
        }>(debugTokenUrl, "debug_token");
        const debugData = debugToken.data;
        debugTokenIsValid = debugData?.is_valid === true;
        debugTokenMatchesApp = debugData?.app_id === appId;
        const pageIds =
          debugTokenIsValid && debugTokenMatchesApp
            ? grantedFacebookPageIds(debugToken)
            : [];
        grantedPageCount = pageIds.length;
        console.info("Meta OAuth granted-page diagnostics:", {
          tokenValid: debugTokenIsValid,
          appIdMatches: debugTokenMatchesApp,
          grantedPageCount: pageIds.length,
        });

        for (let index = 0; index < pageIds.length && !page; index += 5) {
          const batch = pageIds.slice(index, index + 5);
          const results = await Promise.allSettled(
            batch.map(async (pageId) => {
              const { payload } = await graphJsonResponse(
                buildFacebookPageByIdUrl(
                  GRAPH_VERSION,
                  pageId,
                  userAccessToken,
                ),
                "selected_page",
              );
              return inspectFacebookPage(payload, pageId);
            }),
          );
          for (const result of results) {
            if (result.status === "fulfilled" && result.value) {
              page = result.value;
              break;
            }
            if (
              result.status === "rejected" &&
              result.reason instanceof MetaGraphRequestError
            ) {
              selectedPageError = result.reason;
            }
          }
        }
      } catch (error) {
        if (error instanceof MetaGraphRequestError) {
          console.error("Meta OAuth granted-page lookup failed:", {
            stage: error.stage,
            status: error.status,
            networkFailure: error.networkFailure,
            ...error.details,
          });
        } else {
          throw error;
        }
      }
    }

    if (!page?.access_token) {
      if (pageLookup.error) throw pageLookup.error;
      if (selectedPageError) throw selectedPageError;
      const hasPageListPermission = hasGrantedMetaPageListPermission(
        permissions.data,
      );
      const reason = hasPageListPermission
        ? "no_manageable_page"
        : "missing_pages_permission";
      const baseDetail = hasPageListPermission
        ? "أعادت Meta قائمة صفحات فارغة، رغم منح صلاحية pages_show_list."
        : "لم تمنح Meta صلاحية pages_show_list لهذا المستخدم.";
      const permissionDetail =
        hasPageListPermission && debugTokenIsValid === false
          ? "تعذّر التحقق من صلاحية الرمز الذي أعادته Meta."
          : hasPageListPermission && debugTokenMatchesApp === false
            ? "رمز الدخول الذي أعادته Meta مرتبط بتطبيق مختلف عن إعداد الخادم."
            : hasPageListPermission &&
                debugTokenIsValid &&
                grantedPageCount === 0
              ? "لم تتضمن بيانات الرمز أي معرّف صفحة مفوّض ضمن pages_show_list؛ راجع اختيار صفحات التطبيق في شاشة أذونات Meta."
              : hasPageListPermission &&
                  debugTokenIsValid &&
                  (grantedPageCount ?? 0) > 0
                ? `أفادت بيانات الرمز بتفويض ${grantedPageCount} صفحة، لكن Graph API لم يُرجع بيانات صفحة قابلة للاستخدام.`
                : undefined;
      const detail = [baseDetail, permissionDetail]
        .filter((part): part is string => Boolean(part))
        .join(" ");
      appRedirect(res, "error", reason, returnOrigin, detail);
      return;
    }

    const pageTokenDebugUrl = new URL(
      `https://graph.facebook.com/${GRAPH_VERSION}/debug_token`,
    );
    pageTokenDebugUrl.searchParams.set("input_token", page.access_token);
    pageTokenDebugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
    const pageTokenDebug = await graphJson<{
      data?: { is_valid?: boolean; expires_at?: number };
    }>(pageTokenDebugUrl, "verify_page_token");
    if (pageTokenDebug.data?.is_valid !== true) {
      appRedirect(
        res,
        "error",
        "invalid_page_token",
        returnOrigin,
        "تعذر التحقق من رمز صفحة Meta. أعد ربط الحساب وحاول مرة أخرى.",
      );
      return;
    }
    const expiresAtSeconds = pageTokenDebug.data.expires_at;
    const accessTokenExpiresAt =
      typeof expiresAtSeconds === "number" &&
      Number.isFinite(expiresAtSeconds) &&
      expiresAtSeconds > 0
        ? new Date(expiresAtSeconds * 1000)
        : null;
    if (accessTokenExpiresAt && accessTokenExpiresAt <= now) {
      appRedirect(
        res,
        "error",
        "expired_page_token",
        returnOrigin,
        "انتهت صلاحية رمز صفحة Meta. أعد ربط الحساب.",
      );
      return;
    }

    const pageId = normalizeMetaAccountId(page.id);
    if (!pageId) throw new Error("INVALID_META_ACCOUNT_ID");
    const missingPermissions = missingMetaIntegrationPermissions(
      stateRow.requestedIntegration,
      grantedPermissions,
    );
    let instagramAccountData:
      | { id?: unknown; username?: unknown }
      | undefined;
    try {
      const instagramUrl = new URL(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}`,
      );
      instagramUrl.search = new URLSearchParams({
        fields: "instagram_business_account{id,username}",
        access_token: page.access_token,
      }).toString();
      const result = await graphJson<{
        instagram_business_account?: { id?: string; username?: string };
      }>(instagramUrl, "instagram_account");
      if (result.instagram_business_account) {
        instagramAccountData = result.instagram_business_account;
      }
    } catch (error) {
      console.warn("Unable to fetch the linked Instagram business account:", {
        error:
          error instanceof MetaGraphRequestError
            ? { stage: error.stage, status: error.status, ...error.details }
            : error instanceof Error
              ? error.message
              : "Unknown Graph API error",
      });
    }

    const instagramAccountId = normalizeMetaAccountId(
      instagramAccountData?.id,
    );
    const instagramAccountUsername =
      typeof instagramAccountData?.username === "string"
        ? instagramAccountData.username
        : null;
    const [existingConnection] = await db
      .select({
        pageId: menaMetaConnections.pageId,
        instagramUserId: menaMetaConnections.instagramUserId,
        instagramUsername: menaMetaConnections.instagramUsername,
      })
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, stateRow.workspaceId))
      .limit(1);
    const existingInstagramUserId =
      existingConnection?.pageId === pageId
        ? normalizeMetaAccountId(existingConnection.instagramUserId)
        : null;
    const instagramUserId =
      instagramAccountId ??
      existingInstagramUserId;
    const instagramUsername = instagramAccountId
      ? instagramAccountUsername
      : existingInstagramUserId
        ? existingConnection?.instagramUsername ?? null
        : null;
    if (
      stateRow.requestedIntegration === "instagram" &&
      !instagramUserId
    ) {
      appRedirect(
        res,
        "error",
        "instagram_account_required",
        returnOrigin,
        "اربط حساب Instagram احترافيًا (Business أو Creator) بصفحة Facebook التي اخترتها، ثم أعد المحاولة.",
      );
      return;
    }
    if (
      stateRow.requestedIntegration === "instagram" &&
      missingPermissions.length > 0
    ) {
      appRedirect(
        res,
        "error",
        "instagram_permissions_missing",
        returnOrigin,
        `لم تُمنح صلاحيات Instagram المطلوبة: ${missingPermissions.join(", ")}. أعد الربط ووافق على الصلاحيات المطلوبة.`,
      );
      return;
    }
    const metaChannelAccess = await canConnectMetaAccounts(
      stateRow.workspaceId,
      Boolean(instagramUserId),
    );
    if (!metaChannelAccess.allowed) {
      appRedirect(
        res,
        "error",
        "subscription_limit",
        returnOrigin,
        "بلغت الحد الأقصى لقنوات خطتك الحالية. تظهر خيارات الترقية قريبًا.",
      );
      return;
    }
    await assertMetaExternalAccountAvailable(
      stateRow.workspaceId,
      pageId,
      instagramUserId,
    );

    const encryptedPageAccessToken = encryptMetaToken(page.access_token);
    await db
      .insert(menaMetaConnections)
      .values({
        // ownerId records the user who initially connected this row; workspaceId controls access.
        ownerId: stateRow.ownerId,
        workspaceId: stateRow.workspaceId,
        pageId,
        pageName: page.name,
        encryptedPageAccessToken,
        instagramUserId,
        instagramUsername,
        grantedPermissions,
        authorizationVerifiedAt: now,
        accessTokenExpiresAt,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: menaMetaConnections.workspaceId,
        set: {
          pageId,
          pageName: page.name,
          encryptedPageAccessToken,
          grantedPermissions,
          authorizationVerifiedAt: now,
          accessTokenExpiresAt,
          instagramUserId,
          instagramUsername,
          connectedAt: new Date(),
        },
      });

    try {
      const [savedConnection] = await db
        .select()
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, stateRow.workspaceId))
        .limit(1);
      if (savedConnection) {
        await activateMetaWebhookSubscriptionsForConnection(savedConnection);
      }
    } catch (error) {
      logger.warn(
        {
          workspaceId: stateRow.workspaceId,
          reason:
            error instanceof Error
              ? error.message
              : "META_WEBHOOK_SUBSCRIPTION_FAILED",
        },
        "Meta account connected but webhook subscription activation failed",
      );
    }

    appRedirect(
      res,
      stateRow.requestedIntegration === "instagram"
        ? "instagram_connected"
        : "facebook_connected",
      undefined,
      returnOrigin,
      missingPermissions.length > 0
        ? `تم الربط، لكن لم تُمنح الصلاحيات التالية: ${missingPermissions.join(", ")}. أعد الربط بعد تفعيلها في تطبيق Meta لاستخدام هذا التكامل.`
        : undefined,
    );
  } catch (err) {
    if (err instanceof MetaGraphRequestError) {
      console.error("Meta OAuth Graph request failed:", {
        stage: err.stage,
        status: err.status,
        hasData: err.hasData,
        pageCount: err.pageCount,
        networkFailure: err.networkFailure,
        ...err.details,
      });
      appRedirect(
        res,
        "error",
        err.networkFailure ? "meta_graph_unreachable" : `meta_${err.stage}`,
        returnOrigin,
        metaPageListFailureDetail(err.status, err.details),
      );
      return;
    }
    const accountConflict =
      err instanceof MetaConnectionOwnershipConflict
        ? err.account
        : metaConnectionConflictFromError(err);
    if (accountConflict) {
      appRedirect(
        res,
        "error",
        "account_already_connected",
        returnOrigin,
        metaConnectionConflictDetail(accountConflict),
      );
      return;
    }
    if (err instanceof Error && err.message === "INVALID_META_ACCOUNT_ID") {
      appRedirect(
        res,
        "error",
        "invalid_meta_account",
        returnOrigin,
        "أعادت Meta معرّف حساب غير صالح. أعد المحاولة لاحقاً.",
      );
      return;
    }
    console.error("Meta OAuth callback failed:", err);
    appRedirect(res, "error", "connection_failed", returnOrigin);
  }
});

router.delete("/social/meta", requireWorkspace, requireMetaConnectionManager, async (req, res) => {
  const ownerId = requestOwnerId(req);
  const workspaceId = requestWorkspaceId(req);
  if (!ownerId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const platform = req.query.platform ?? "facebook";
  if (platform !== "facebook" && platform !== "instagram") {
    res.status(400).json({ error: "حدد منصة Meta المراد فصلها." });
    return;
  }

  const [connection] = await db
    .select()
    .from(menaMetaConnections)
    .where(eq(menaMetaConnections.workspaceId, workspaceId))
    .limit(1);
  if (!connection) {
    res.json({
      disconnected: true,
      alreadyDisconnected: true,
      platform,
      externalRevocation: "unavailable",
    });
    return;
  }

  if (platform === "instagram") {
    if (!connection.instagramUserId) {
      res.json({
        disconnected: true,
        alreadyDisconnected: true,
        platform,
        externalRevocation: "unavailable",
      });
      return;
    }
    const updated = await db
      .update(menaMetaConnections)
      .set({ instagramUserId: null, instagramUsername: null })
      .where(
        and(
          eq(menaMetaConnections.workspaceId, workspaceId),
          eq(menaMetaConnections.pageId, connection.pageId),
          eq(menaMetaConnections.instagramUserId, connection.instagramUserId),
        ),
      )
      .returning({ ownerId: menaMetaConnections.ownerId });
    if (updated.length === 0) {
      const [latest] = await db
        .select({ instagramUserId: menaMetaConnections.instagramUserId })
        .from(menaMetaConnections)
        .where(eq(menaMetaConnections.workspaceId, workspaceId))
        .limit(1);
      if (!latest || !latest.instagramUserId) {
        res.json({
          disconnected: true,
          alreadyDisconnected: true,
          platform,
          externalRevocation: "unavailable",
        });
        return;
      }
      res
        .status(409)
        .json({ error: "تغير اتصال الحساب. حدّث الصفحة وحاول مجدداً." });
      return;
    }
    res.json({
      disconnected: true,
      platform,
      externalRevocation: "unavailable",
    });
    return;
  }

  const deleted = await db
    .delete(menaMetaConnections)
    .where(
      and(
        eq(menaMetaConnections.workspaceId, workspaceId),
        eq(menaMetaConnections.pageId, connection.pageId),
      ),
    )
    .returning({ ownerId: menaMetaConnections.ownerId });
  if (deleted.length === 0) {
    const [latest] = await db
      .select({ pageId: menaMetaConnections.pageId })
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId))
      .limit(1);
    if (!latest) {
      res.json({
        disconnected: true,
        alreadyDisconnected: true,
        platform,
        externalRevocation: "unavailable",
      });
      return;
    }
    res
      .status(409)
      .json({ error: "تغير اتصال الحساب. حدّث الصفحة وحاول مجدداً." });
    return;
  }
  res.json({
    disconnected: true,
    platform,
    alsoDisconnectedInstagram: Boolean(connection.instagramUserId),
    externalRevocation: "unavailable",
  });
});

export default router;
