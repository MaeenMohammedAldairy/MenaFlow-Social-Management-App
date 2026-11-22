import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";
import {
  assertProductionConfiguration,
  isLocalAuthDisabled,
  requestOwnerId,
} from "./lib/owner-access";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

assertProductionConfiguration();

const app: Express = express();
const requestIpKey = (req: express.Request): string => {
  const ip = req.ip ?? req.socket.remoteAddress;
  return ip ? ipKeyGenerator(ip) : "unknown";
};
const rateLimitKey = (req: express.Request): string => {
  const userId = requestOwnerId(req);
  return userId ? `user:${userId}` : requestIpKey(req);
};
const clerkAuthRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIpKey,
  handler: (_req, res) => {
    res.status(429).json({
      error: "محاولات المصادقة كثيرة جدًا. انتظر قليلًا ثم حاول مجددًا.",
      code: "AUTH_RATE_LIMITED",
    });
  },
});
const evolutionWebhookRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 1_200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIpKey,
  handler: (_req, res) => {
    res.status(429).json({
      error: "تجاوز ويبهوك واتساب الحد المؤقت للطلبات. أعد المحاولة لاحقًا.",
      code: "EVOLUTION_WEBHOOK_RATE_LIMITED",
    });
  },
});
const ownerConsoleRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: requestIpKey,
  handler: (_req, res) => {
    res.status(429).json({
      error: "طلبات كثيرة على لوحة المالك. انتظر دقيقة ثم أعد المحاولة.",
      code: "OWNER_CONSOLE_RATE_LIMITED",
    });
  },
});
const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  skip: (req) =>
    [
      "/healthz",
      "/readyz",
      "/social/meta/webhook",
      "/social/whatsapp/webhook",
    ].includes(req.path),
  handler: (_req, res) => {
    res.status(429).json({
      error: "أرسلت طلبات كثيرة خلال وقت قصير. حاول لاحقًا.",
      code: "RATE_LIMITED",
    });
  },
});
const aiContentRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
  handler: (_req, res) => {
    res
      .status(429)
      .json({ error: "وصلت إلى حد التوليد المؤقت. حاول بعد دقيقة." });
  },
});
const configuredCorsOrigins = new Set(
  (process.env.MENA_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.use(helmet());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
if (!isLocalAuthDisabled()) {
  app.use(CLERK_PROXY_PATH, clerkAuthRateLimit);
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
}
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (
        !origin ||
        process.env.NODE_ENV !== "production" ||
        configuredCorsOrigins.has(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use("/api", healthRouter);

if (!isLocalAuthDisabled()) {
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY ??
          process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}
app.use("/api/social/whatsapp/webhook", evolutionWebhookRateLimit);
app.use("/api", apiRateLimit);
app.use("/api/ai/content", aiContentRateLimit);
app.use(
  "/api/social/meta/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use("/api/social/whatsapp/webhook", express.json({ limit: "1mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Owner console: an internal read-only dashboard, built from
 * `artifacts/owner-console` and served by this same process so it needs neither
 * a second host nor a second domain. The page itself is public HTML with a
 * noindex header; every number behind it requires the owner credentials checked
 * in `routes/owner.ts`.
 */
const ownerConsoleDir =
  process.env.MENA_OWNER_CONSOLE_DIST?.trim() ||
  fileURLToPath(new URL("../../owner-console/dist", import.meta.url));
const ownerConsoleIndex = `${ownerConsoleDir}/index.html`;
const ownerConsoleAvailable = existsSync(ownerConsoleIndex);

if (ownerConsoleAvailable) {
  app.use(
    "/owner",
    express.static(ownerConsoleDir, {
      index: false,
      maxAge: "1h",
      setHeaders(res, filePath) {
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
        res.setHeader("Referrer-Policy", "no-referrer");
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    }),
  );
  app.get(/^\/owner(?:\/.*)?$/, (req, res) => {
    const lastSegment = req.path.split("/").pop() ?? "";
    if (lastSegment.includes(".") && !lastSegment.endsWith(".html")) {
      // A missing asset must not be answered with the SPA shell.
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(ownerConsoleIndex);
  });
} else {
  app.get(/^\/owner(?:\/.*)?$/, (_req, res) => {
    res.status(503).type("text/plain").send(
      "Owner console is not built. Run `pnpm --filter @workspace/owner-console run build` and restart the API.",
    );
  });
}

app.use("/api/owner", ownerConsoleRateLimit);
app.use("/api", router);

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = (req as express.Request & { id?: string | number }).id;
    const errorDetails =
      error && typeof error === "object"
        ? (error as { status?: unknown; statusCode?: unknown; type?: unknown })
        : null;
    if (
      req.path === "/api/social/whatsapp/webhook" &&
      (errorDetails?.status === 413 ||
        errorDetails?.statusCode === 413 ||
        errorDetails?.type === "entity.too.large")
    ) {
      logger.warn(
        { requestId, method: req.method, path: req.path },
        "WhatsApp webhook payload exceeded the configured size limit",
      );
      res.status(413).json({
        ok: false,
        error: "Webhook payload exceeds the configured size limit.",
        code: "WHATSAPP_WEBHOOK_PAYLOAD_TOO_LARGE",
      });
      return;
    }

    logger.error(
      { err: error, requestId, method: req.method, path: req.path },
      "Unhandled API request error",
    );
    res.status(500).json({
      error: "حدث خطأ غير متوقع. حاول مرة أخرى لاحقًا.",
      code: "INTERNAL_SERVER_ERROR",
      ...(requestId !== undefined ? { requestId: String(requestId) } : {}),
    });
  },
);

export default app;
