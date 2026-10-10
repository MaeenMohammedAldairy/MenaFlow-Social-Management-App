import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";

function configuredOwnerEmail(): string | null {
  const email = process.env.MENA_OWNER_EMAIL?.trim().toLowerCase();
  return email || null;
}

export function isOwnerRequest(req: Request): boolean {
  const expectedEmail = configuredOwnerEmail();
  if (!expectedEmail) return false;

  const claims = getAuth(req).sessionClaims as
    | (Record<string, unknown> & { email?: unknown })
    | undefined;
  const sessionEmail =
    typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : "";
  return sessionEmail === expectedEmail;
}

export const requireOwner: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  if (!configuredOwnerEmail()) {
    res.status(503).json({ error: "إعداد صلاحية المالك غير مكتمل." });
    return;
  }
  if (!isOwnerRequest(req)) {
    res.status(403).json({ error: "هذا الحساب غير مخوّل لاستخدام مساحة MenaFlow." });
    return;
  }
  next();
};
