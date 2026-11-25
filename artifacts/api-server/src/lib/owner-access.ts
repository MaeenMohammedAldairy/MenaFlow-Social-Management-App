import { getAuth } from "@clerk/express";
import type { Request, RequestHandler, Response } from "express";

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
  const usesTestSecret = clerkSecretKey.startsWith("sk_test_");
  const usesTestPublishable = clerkPublishableKey.startsWith("pk_test_");

  if (usesTestSecret !== usesTestPublishable) {
    throw new Error(
      "CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY must use the same Clerk environment.",
    );
  }

  if (
    usesTestSecret &&
    process.env.MENA_ALLOW_CLERK_TEST_KEYS_IN_PRODUCTION !== "true"
  ) {
    throw new Error(
      "Clerk test keys require MENA_ALLOW_CLERK_TEST_KEYS_IN_PRODUCTION=true.",
    );
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

  // Evolution's admin API key must never double as the webhook secret: this API
  // stores the webhook secret in the provider's webhook configuration, so
  // reusing the admin key would widen a webhook leak into full control over
  // every WhatsApp instance.
  const evolutionApiKey = process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
  if (evolutionApiKey) {
    const evolutionWebhookSecret =
      process.env.WHATSAPP_EVOLUTION_WEBHOOK_SECRET?.trim();
    if (!evolutionWebhookSecret) {
      throw new Error(
        "WHATSAPP_EVOLUTION_WEBHOOK_SECRET must be configured in production when Evolution is enabled; it must not fall back to WHATSAPP_EVOLUTION_API_KEY.",
      );
    }
    if (evolutionWebhookSecret === evolutionApiKey) {
      throw new Error(
        "WHATSAPP_EVOLUTION_WEBHOOK_SECRET must differ from WHATSAPP_EVOLUTION_API_KEY in production.",
      );
    }
  }
}

/** The one wording of "you are not signed in", for every route that has to say it. */
export const signInRequiredMessage = "سجّل الدخول أولاً.";

/**
 * The caller's owner id, or null after answering the request with 401.
 *
 * Routes need the id itself, not just a yes/no, so a middleware alone never
 * replaced the check — `requireOwner` below sat unused while 70-odd handlers
 * each wrote out "read the id, refuse if missing". This is the half they share;
 * the caller keeps `if (!ownerId) return;` because only it knows what to do next.
 */
export function requireOwnerId(req: Request, res: Response): string | null {
  const ownerId = requestOwnerId(req);
  if (ownerId) return ownerId;
  res.status(401).json({ error: signInRequiredMessage });
  return null;
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
  if (!requireOwnerId(req, res)) return;
  next();
};

/**
 * Role policies — the only place that answers "who may do what by role".
 *
 * Three gates used to carry three spellings of the same question: an inline
 * `role !== "owner"` in `routes/workspaces.ts`, this predicate in
 * `meta-oauth.ts`, and an owner-or-admin check in `requireProductWriter`.
 * The first stays inline (it answers 500 when the context is missing); the
 * other two live here so the one difference between them is visible.
 */

/** Connecting or disconnecting Meta accounts: the owner only. */
export function canManageMetaConnections(role: string): boolean {
  return role === "owner";
}

/**
 * Changing the product catalog: the owner, and `admin`.
 *
 * `admin` is a role nothing assigns today — memberships are created as `owner`
 * (the workspace bootstrap) and invitations are not built — so this is
 * owner-only in practice, like every other gate. The wider allowance is kept
 * on purpose rather than folded into the owner-only rule: product writes change
 * what the auto-reply and the order intake will tell customers, which is the
 * one area a future `admin` was meant to help with. When roles arrive, this is
 * where that decision is made — not in a middleware three modules away.
 */
export function canWriteProducts(role: string): boolean {
  return role === "owner" || role === "admin";
}
