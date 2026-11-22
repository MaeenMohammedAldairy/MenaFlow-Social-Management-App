import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Access rules for the owner console.
 *
 * The console is an internal surface: it must never become reachable with a
 * normal customer session. Access is granted either by a signed-in Clerk user
 * listed in `MENA_OWNER_USER_IDS`, or by a static console token configured in
 * `MENA_OWNER_CONSOLE_TOKEN` (comma-separated, so a token can be rotated
 * without downtime). With neither configured the console is disabled, and every
 * request is answered as if the route did not exist.
 */
export type OwnerConsoleMode = "clerk" | "token" | "dev" | "disabled";

export type OwnerConsoleAccess = {
  allowed: boolean;
  mode: OwnerConsoleMode;
  reason: "ok" | "disabled" | "missing" | "rejected";
  userId: string | null;
};

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ownerUserIds(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return splitList(env.MENA_OWNER_USER_IDS);
}

export function ownerConsoleTokens(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return splitList(env.MENA_OWNER_CONSOLE_TOKEN).filter(
    (token) => token.length >= 24,
  );
}

function localDevOwnerConfigured(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === "development" &&
    env.MENA_AUTH_DISABLED === "true" &&
    Boolean(env.MENA_OWNER_EMAIL?.trim())
  );
}

export function ownerConsoleMode(
  env: NodeJS.ProcessEnv = process.env,
): OwnerConsoleMode {
  if (ownerConsoleTokens(env).length > 0) return "token";
  if (ownerUserIds(env).length > 0) return "clerk";
  if (localDevOwnerConfigured(env)) return "dev";
  return "disabled";
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  // Parsed by hand instead of a regular expression so a hostile header such as
  // "bearer" followed by thousands of spaces stays linear.
  const separator = header.indexOf(" ");
  if (separator <= 0) return null;
  if (header.slice(0, separator).toLowerCase() !== "bearer") return null;
  const token = header.slice(separator + 1).trim();
  return token.length > 0 ? token : null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Compares a console token against the configured ones in constant time. */
export function matchesOwnerConsoleToken(
  candidate: string | null | undefined,
  tokens: string[] = ownerConsoleTokens(),
): boolean {
  if (!candidate || tokens.length === 0) return false;
  const provided = digest(candidate);
  return tokens.some((token) => timingSafeEqual(digest(token), provided));
}

export function resolveOwnerConsoleAccess(input: {
  userId: string | null;
  authorization: string | undefined;
  env?: NodeJS.ProcessEnv;
}): OwnerConsoleAccess {
  const env = input.env ?? process.env;
  const mode = ownerConsoleMode(env);
  if (mode === "disabled") {
    return { allowed: false, mode, reason: "disabled", userId: null };
  }
  if (mode === "dev") {
    return { allowed: true, mode, reason: "ok", userId: input.userId };
  }
  const token = bearerToken(input.authorization);
  if (token && matchesOwnerConsoleToken(token, ownerConsoleTokens(env))) {
    return { allowed: true, mode, reason: "ok", userId: input.userId };
  }
  if (input.userId && ownerUserIds(env).includes(input.userId)) {
    return { allowed: true, mode, reason: "ok", userId: input.userId };
  }
  return {
    allowed: false,
    mode,
    reason: input.userId || token ? "rejected" : "missing",
    userId: input.userId,
  };
}

export type OwnerWindowKey = "24h" | "7d" | "30d";

export const ownerWindowHours: Record<OwnerWindowKey, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

export function parseOwnerWindow(value: unknown): {
  key: OwnerWindowKey;
  hours: number;
  since: Date;
} {
  const key =
    typeof value === "string" && value in ownerWindowHours
      ? (value as OwnerWindowKey)
      : "24h";
  const hours = ownerWindowHours[key];
  return { key, hours, since: new Date(Date.now() - hours * 60 * 60 * 1000) };
}

export function clampOwnerLimit(
  value: unknown,
  fallback = 25,
  max = 100,
): number {
  const parsed =
    typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.trunc(parsed), max);
}

/** Current billing period key, matching `mena_workspace_subscription_usage`. */
export function ownerUsagePeriodKey(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
