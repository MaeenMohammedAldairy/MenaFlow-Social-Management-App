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
