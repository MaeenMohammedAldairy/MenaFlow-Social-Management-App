import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";

export function isLocalAuthDisabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.MENA_AUTH_DISABLED === "true"
  );
}

export function assertProductionConfiguration(): void {
  if (process.env.NODE_ENV !== "production") return;

  if (process.env.MENA_AUTH_DISABLED === "true") {
    throw new Error("MENA_AUTH_DISABLED must not be enabled in production.");
  }

  const clerkSecretKey = process.env.CLERK_SECRET_KEY?.trim();
  const clerkPublishableKey = (
    process.env.CLERK_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  )?.trim();
  if (!clerkSecretKey || !clerkPublishableKey) {
    throw new Error(
      "CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY must be configured in production.",
    );
  }
  if (
    clerkSecretKey.startsWith("sk_test_") ||
    clerkPublishableKey.startsWith("pk_test_")
  ) {
    throw new Error("Clerk test keys must not be used in production.");
  }

  if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY must be configured with at least 32 characters in production.",
    );
  }

  if (
    process.env.ENCRYPTION_KEY_PREVIOUS &&
    process.env.ENCRYPTION_KEY_PREVIOUS.length < 32
  ) {
    throw new Error(
      "ENCRYPTION_KEY_PREVIOUS must contain at least 32 characters when configured.",
    );
  }

  const corsOrigins = (process.env.MENA_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.protocol !== "https:" || parsedOrigin.origin !== origin) {
        throw new Error();
      }
    } catch {
      throw new Error(
        "MENA_CORS_ORIGINS must contain comma-separated HTTPS origins without paths.",
      );
    }
  }
}

/** Returns the verified Clerk user ID, or the explicitly configured single local-dev identity. */
export function requestOwnerId(req: Request): string | null {
  if (isLocalAuthDisabled()) {
    const email = process.env.MENA_OWNER_EMAIL?.trim().toLowerCase();
    if (!email) return null;
    return `dev:${email.replace(/[^a-z0-9.@_-]/g, "_")}`;
  }
  return getAuth(req).userId ?? null;
}

/**
 * Middleware that ensures the request is authenticated.
 * In dev mode (MENA_AUTH_DISABLED), always passes through.
 * In production, requires a valid Clerk session for any user.
 */
export const requireOwner: RequestHandler = (req, res, next) => {
  if (isLocalAuthDisabled()) {
    next();
    return;
  }

  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  next();
};
