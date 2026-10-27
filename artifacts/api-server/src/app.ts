import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import healthRouter from "./routes/health";
import { logger } from "./lib/logger";
import {
  assertProductionConfiguration,
  isLocalAuthDisabled,
} from "./lib/owner-access";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

assertProductionConfiguration();

const app: Express = express();
const configuredCorsOrigins = new Set(
  (process.env.MENA_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

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
app.use(
  "/api/social/meta/webhook",
  express.raw({ type: "application/json", limit: "1mb" }),
);
app.use("/api/social/whatsapp/webhook", express.json({ limit: "1mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
