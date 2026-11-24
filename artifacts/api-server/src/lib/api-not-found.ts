import type { Request, Response } from "express";

/**
 * JSON 404 for unknown `/api` paths.
 *
 * Without this, an unmatched API path fell through to Express's default HTML
 * 404 — a different shape from every other error the server answers with, so
 * the mobile error mapping (`lib/error-diagnostics.ts`, `lib/auth-error-message.ts`)
 * had nothing to parse and showed a generic failure. It also made a typo in a
 * client path look like a server outage rather than a missing route.
 *
 * Mounted under `/api` only and *after* the router, so the owner console's own
 * asset 404 (`app.ts`) and every real route keep their behaviour.
 */
export function apiNotFoundHandler(req: Request, res: Response): void {
  const requestId = (req as Request & { id?: string | number }).id;
  // `req.path` is relative to the "/api" mount, which is not what the client
  // asked for; report the original target so a typo is obvious in the log.
  const requestedPath = (req.originalUrl ?? req.url ?? "").split("?")[0];
  res.status(404).json({
    error: "المسار المطلوب غير موجود في هذه الواجهة.",
    code: "ROUTE_NOT_FOUND",
    method: req.method,
    path: requestedPath,
    ...(requestId !== undefined ? { requestId: String(requestId) } : {}),
  });
}
